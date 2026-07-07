/**
 * InfoSimples → monitoramento SÓ dos casos já cadastrados (curado pelo Miguel).
 *
 * DECISÃO 07/07/2026: substituiu a descoberta automática por OAB
 * (`infosimples-sync.ts`, agora desligada por padrão). O Miguel já tem a lista
 * real dos processos de execução penal do escritório e cadastra manualmente
 * (cliente + matrícula + CNJ); descobrir sozinho "o que é execução penal"
 * varrendo a OAB inteira gerava classificação errada e custo sem controle.
 *
 * CORREÇÃO 07/07/2026 (mesma noite, testado ao vivo com token real): a busca
 * direta por CNJ (parâmetro `processo` do endpoint tjsp/primeiro-grau) provou
 * ser NÃO CONFIÁVEL — testada com 2 CNJs reais do banco, as DUAS vezes
 * retornou um processo DIFERENTE do pedido (não é erro de formatação: testado
 * com e sem pontuação, sempre errado). Se eu tivesse confiado nisso sem
 * validar, teria colado movimentação do processo ERRADO no caso certo.
 *
 * Por isso este arquivo volta a usar `fetchTjspByOab` (busca por OAB — a
 * MESMA usada pela descoberta antiga, comprovadamente correta em produção há
 * semanas) e filtra LOCALMENTE pelos CNJs já cadastrados. A diferença pro
 * modelo antigo: nunca registra caso novo — só atualiza o que já existe.
 * Continua "curado" (sem descoberta automática), só muda o mecanismo de busca.
 *
 * Dois usos:
 *   1. `syncCaseByCnj(db, cnj)` — sob demanda, disparada no cadastro do caso
 *      (ou no botão "Sincronizar Tribunal") via `crawler.sync.requested`.
 *      Varre a OAB página a página e para assim que acha o CNJ pedido (sai
 *      cedo — no melhor caso custa 1 página, não a OAB inteira).
 *   2. `runCuratedInfosimplesSync(db)` — cron a cada 3 dias, varre a OAB
 *      inteira UMA vez e atualiza TODOS os casos curados encontrados nessa
 *      passada (muito mais barato que uma consulta por caso).
 */

import { eq, and, isNotNull } from 'drizzle-orm'
import { executionCases, oabProfiles } from '@execflow/db/schema'
import type { WorkersDb } from '../lib/db.ts'
import { createInfosimplesConfig, fetchTjspByOab, type InfosimplesProcess } from '../integrations/infosimples-client.ts'
import {
  createInternalApiConfig,
  pushCaseMovements,
  type InternalMovementItem,
} from '../integrations/internal-api-client.ts'
import { createHash } from 'node:crypto'

// Ritmo conservador entre consultas (páginas) — contas InfoSimples (sobretudo
// em saldo promocional/teste) podem ter limite de requisições por minuto para
// consultas de tribunal (captcha-heavy, ~5 req/min segundo relato do Miguel,
// não confirmado na documentação oficial). 20s entre chamadas (3/min) fica
// bem abaixo desse teto.
export const INFOSIMPLES_THROTTLE_MS = 20_000
const MAX_PAGES = Number(process.env['INFOSIMPLES_MAX_PAGES'] ?? '20') || 20

async function sleep(ms: number): Promise<void> {
  await new Promise((res) => setTimeout(res, ms))
}

function stableDedupKey(cnj: string, mov: { data: string; movimento: string }): string {
  return createHash('sha256').update(`${cnj}|${mov.data}|${mov.movimento}`).digest('hex').slice(0, 32)
}

function parseBrDateIso(s: string): string {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) {
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

function toMovementItems(cnj: string, proc: InfosimplesProcess): InternalMovementItem[] {
  return proc.movimentacoes.map((m) => ({
    tipo: 'Movimentação processual',
    conteudo: m.movimento,
    occurredAt: parseBrDateIso(m.data),
    source: 'infosimples',
    kind: 'movimentacao',
    dedupKey: stableDedupKey(cnj, m),
  }))
}

type OabTarget = { numero: string; uf: string }

/** Mesma resolução de OAB usada pela descoberta antiga: perfis do inventário + fallback .env. */
async function resolveOabs(db: WorkersDb): Promise<OabTarget[]> {
  const profiles = await db
    .select({ numero: oabProfiles.oabNumber, uf: oabProfiles.oabUf })
    .from(oabProfiles)
  const envOabs = (process.env['INFOSIMPLES_OABS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => {
      const [numero, uf] = t.split('/')
      return { numero: (numero ?? '').trim(), uf: (uf ?? '').trim().toUpperCase() }
    })
  const seen = new Set<string>()
  return [...profiles, ...envOabs].filter((o) => {
    const k = `${o.numero}/${o.uf}`.toUpperCase()
    if (!o.numero || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

async function pushProcessMovements(
  internal: { baseUrl: string; token: string },
  cnj: string,
  proc: InfosimplesProcess
): Promise<{ movementsFound: number; matched: boolean; opportunitiesCreated: number; markedStale: boolean }> {
  const movements = toMovementItems(cnj, proc)
  const ingest = await pushCaseMovements(internal, cnj, movements)
  return {
    movementsFound: movements.length,
    matched: ingest.matched,
    opportunitiesCreated: ingest.opportunitiesCreated,
    markedStale: ingest.markedStale,
  }
}

export type CaseInfosimplesSyncResult = {
  found: boolean
  /** true quando não achou o processo na OAB — pode ser CNJ errado, segredo de justiça, ou OAB diferente. */
  notFound: boolean
  networkError: boolean
  movementsFound: number
  matched: boolean
  opportunitiesCreated: number
  markedStale: boolean
  error: string | null
}

/**
 * Busca UM processo por CNJ, varrendo as páginas da OAB e saindo assim que
 * encontra (early-exit — no melhor caso custa 1 página). Empurra a
 * movimentação pela cadeia de reanálise. NUNCA cria caso novo.
 */
export async function syncCaseByCnj(db: WorkersDb, cnj: string): Promise<CaseInfosimplesSyncResult> {
  const empty: CaseInfosimplesSyncResult = {
    found: false,
    notFound: false,
    networkError: false,
    movementsFound: 0,
    matched: false,
    opportunitiesCreated: 0,
    markedStale: false,
    error: null,
  }

  const info = createInfosimplesConfig()
  const internal = createInternalApiConfig()
  if (!info) return { ...empty, error: 'INFOSIMPLES_TOKEN ausente' }
  if (!internal) return { ...empty, error: 'EXECFLOW_API_URL/INTERNAL_API_TOKEN ausentes' }

  const oabs = await resolveOabs(db)
  if (oabs.length === 0) return { ...empty, error: 'Nenhuma OAB configurada' }

  const targetDigits = cnj.replace(/\D/g, '')

  for (const oab of oabs) {
    let page = 1
    let totalPages = 1
    do {
      const res = await fetchTjspByOab(info, oab.numero, page)
      if (res.networkError) return { ...empty, networkError: true, error: 'Falha de rede na InfoSimples' }
      if (!res.ok) {
        if (res.code !== 612) return { ...empty, error: `InfoSimples code ${res.code}: ${res.message}` }
        break
      }
      totalPages = res.totalPages

      const match = res.processes.find((p) => p.processo.replace(/\D/g, '') === targetDigits)
      if (match) {
        const pushed = await pushProcessMovements(internal, cnj, match)
        return { found: true, notFound: false, networkError: false, error: null, ...pushed }
      }

      page++
      if (page <= totalPages && page <= MAX_PAGES) await sleep(INFOSIMPLES_THROTTLE_MS)
    } while (page <= totalPages && page <= MAX_PAGES)
  }

  return { ...empty, notFound: true }
}

export type CuratedSyncResult = {
  casesCurated: number
  found: number
  notFound: number
  networkErrors: number
  movementsFound: number
  pagesFetched: number
  estimatedCostBrl: number
  error: string | null
}

/**
 * Cron a cada 3 dias: varre a OAB inteira UMA vez (todas as páginas) e
 * atualiza TODOS os casos curados (já cadastrados) encontrados na passada.
 * Nunca descobre/cadastra processo novo — o que não está em
 * execution_cases é ignorado, mesmo que apareça na busca da OAB.
 */
export async function runCuratedInfosimplesSync(db: WorkersDb): Promise<CuratedSyncResult> {
  const result: CuratedSyncResult = {
    casesCurated: 0,
    found: 0,
    notFound: 0,
    networkErrors: 0,
    movementsFound: 0,
    pagesFetched: 0,
    estimatedCostBrl: 0,
    error: null,
  }

  const info = createInfosimplesConfig()
  const internal = createInternalApiConfig()
  if (!info) {
    result.error = 'INFOSIMPLES_TOKEN ausente'
    return result
  }
  if (!internal) {
    result.error = 'EXECFLOW_API_URL/INTERNAL_API_TOKEN ausentes'
    return result
  }

  const curatedCases = await db
    .select({ cnj: executionCases.executionProcessNumber })
    .from(executionCases)
    .where(and(eq(executionCases.status, 'active'), isNotNull(executionCases.executionProcessNumber)))
  const curatedDigits = new Set(curatedCases.map((c) => (c.cnj ?? '').replace(/\D/g, '')).filter(Boolean))
  result.casesCurated = curatedDigits.size

  if (curatedDigits.size === 0) {
    result.error = 'Nenhum caso ativo cadastrado com CNJ.'
    return result
  }

  const oabs = await resolveOabs(db)
  if (oabs.length === 0) {
    result.error = 'Nenhuma OAB configurada'
    return result
  }

  const foundThisRun = new Set<string>()

  try {
    for (const oab of oabs) {
      let page = 1
      let totalPages = 1
      do {
        const res = await fetchTjspByOab(info, oab.numero, page)
        if (res.networkError) {
          result.networkErrors++
          break
        }
        if (!res.ok) {
          if (res.code !== 612) console.warn(`[case-infosimples-sync] OAB ${oab.numero}: code ${res.code} ${res.message}`)
          break
        }
        result.pagesFetched++
        result.estimatedCostBrl += 0.2
        totalPages = res.totalPages

        for (const proc of res.processes) {
          const digits = proc.processo.replace(/\D/g, '')
          if (!curatedDigits.has(digits) || foundThisRun.has(digits)) continue
          foundThisRun.add(digits)
          const pushed = await pushProcessMovements(internal, proc.processo, proc)
          result.found++
          result.movementsFound += pushed.movementsFound
        }

        page++
        if (page <= totalPages && page <= MAX_PAGES) await sleep(INFOSIMPLES_THROTTLE_MS)
      } while (page <= totalPages && page <= MAX_PAGES)
    }

    result.notFound = curatedDigits.size - foundThisRun.size

    console.info(
      `[case-infosimples-sync] ${result.casesCurated} caso(s) curado(s), ${result.pagesFetched} pág. ` +
        `(~R$${result.estimatedCostBrl.toFixed(2)}), ${result.found} encontrado(s) (${result.movementsFound} movimentação(ões)), ` +
        `${result.notFound} não encontrado(s) (possível segredo de justiça/CNJ incorreto/fora da OAB), ${result.networkErrors} falha(s) de rede.`
    )
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error('[case-infosimples-sync] Falha:', err)
  }

  return result
}
