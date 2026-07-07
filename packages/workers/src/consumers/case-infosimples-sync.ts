/**
 * InfoSimples → monitoramento SÓ dos casos já cadastrados (curado pelo Miguel).
 *
 * DECISÃO 07/07/2026: substituiu a descoberta automática por OAB
 * (`infosimples-sync.ts`, agora desligada por padrão). O Miguel já tem a lista
 * real dos processos de execução penal do escritório e cadastra manualmente
 * (cliente + matrícula + CNJ); descobrir sozinho "o que é execução penal"
 * varrendo a OAB inteira gerava classificação errada e custo sem controle.
 *
 * Dois usos desta mesma busca por CNJ (`fetchTjspByProcesso`):
 *   1. `syncCaseByCnj()` — sob demanda, disparada no cadastro do caso (ou no
 *      botão "Sincronizar Tribunal") via `crawler.sync.requested` (ver
 *      `crawler-sync.ts`). Busca AQUELE processo, uma vez.
 *   2. `runCuratedInfosimplesSync()` — cron a cada 3 dias (worker-registry.ts),
 *      itera SÓ os casos ativos já cadastrados (nunca cria caso novo) e
 *      atualiza movimentação de cada um.
 *
 * Custo: R$0,20/consulta × nº de casos cadastrados (não mais por página da
 * OAB inteira). Para 40 casos, a cada 3 dias ≈ R$8/rodada ≈ R$80/mês — mais
 * caro por caso que a varredura antiga, mas sem gastar consultando processo
 * que não é nosso. Frequência decidida com o Miguel em 07/07/2026 (execução
 * penal se move devagar, atraso de até 3 dias raramente importa). Ajuste o
 * cron em worker-registry.ts se quiser mudar de novo.
 */

import { eq, and, isNotNull } from 'drizzle-orm'
import { executionCases } from '@execflow/db/schema'
import type { WorkersDb } from '../lib/db.ts'
import { createInfosimplesConfig, fetchTjspByProcesso, type InfosimplesProcess } from '../integrations/infosimples-client.ts'
import {
  createInternalApiConfig,
  pushCaseMovements,
  type InternalMovementItem,
} from '../integrations/internal-api-client.ts'
import { createHash } from 'node:crypto'

const THROTTLE_MS = 800

export type CaseInfosimplesSyncResult = {
  found: boolean
  /** true quando InfoSimples não achou o processo — pode ser CNJ errado OU segredo de justiça. */
  notFound: boolean
  networkError: boolean
  movementsFound: number
  matched: boolean
  opportunitiesCreated: number
  markedStale: boolean
  error: string | null
}

function stableDedupKey(cnj: string, mov: { data: string; movimento: string }): string {
  return createHash('sha256').update(`${cnj}|${mov.data}|${mov.movimento}`).digest('hex').slice(0, 32)
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

function parseBrDateIso(s: string): string {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) {
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

/**
 * Busca UM processo por CNJ e empurra as movimentações pela cadeia de
 * reanálise (a mesma do DJEN/DataJud — IA classifica, gera oportunidade,
 * marca stale, prazo provisório). NUNCA cria caso novo: só atualiza um caso
 * que já existe (`pushCaseMovements` casa por CNJ; se não achar, vira órfã).
 */
export async function syncCaseByCnj(cnj: string): Promise<CaseInfosimplesSyncResult> {
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

  const res = await fetchTjspByProcesso(info, cnj)
  if (res.networkError) return { ...empty, networkError: true, error: 'Falha de rede na InfoSimples' }
  if (!res.ok) {
    // 612 = processo não encontrado (CNJ errado OU segredo de justiça — não dá pra diferenciar aqui).
    if (res.code === 612) return { ...empty, notFound: true }
    return { ...empty, error: `InfoSimples code ${res.code}: ${res.message}` }
  }

  const proc = res.processes.find((p) => p.processo.replace(/\D/g, '') === cnj.replace(/\D/g, '')) ?? res.processes[0]
  if (!proc) return { ...empty, notFound: true }

  const movements = toMovementItems(cnj, proc)
  const ingest = await pushCaseMovements(internal, cnj, movements)

  return {
    found: true,
    notFound: false,
    networkError: false,
    movementsFound: movements.length,
    matched: ingest.matched,
    opportunitiesCreated: ingest.opportunitiesCreated,
    markedStale: ingest.markedStale,
    error: null,
  }
}

export type CuratedSyncResult = {
  casesQueried: number
  found: number
  notFound: number
  networkErrors: number
  movementsFound: number
  estimatedCostBrl: number
  error: string | null
}

/**
 * Cron diário: passa por TODOS os casos ativos já cadastrados (curados pelo
 * Miguel) e atualiza a movimentação de cada um via InfoSimples. Nunca
 * descobre/cadastra processo novo — só atualiza o que já existe.
 */
export async function runCuratedInfosimplesSync(db: WorkersDb): Promise<CuratedSyncResult> {
  const result: CuratedSyncResult = {
    casesQueried: 0,
    found: 0,
    notFound: 0,
    networkErrors: 0,
    movementsFound: 0,
    estimatedCostBrl: 0,
    error: null,
  }

  const info = createInfosimplesConfig()
  if (!info) {
    result.error = 'INFOSIMPLES_TOKEN ausente'
    return result
  }

  const cases = await db
    .select({ id: executionCases.id, cnj: executionCases.executionProcessNumber })
    .from(executionCases)
    .where(and(eq(executionCases.status, 'active'), isNotNull(executionCases.executionProcessNumber)))

  for (const c of cases) {
    if (!c.cnj) continue
    result.casesQueried++
    const r = await syncCaseByCnj(c.cnj)
    result.estimatedCostBrl += 0.2
    if (r.networkError) result.networkErrors++
    else if (r.notFound) result.notFound++
    else if (r.found) {
      result.found++
      result.movementsFound += r.movementsFound
    }
    await new Promise((res) => setTimeout(res, THROTTLE_MS))
  }

  console.info(
    `[case-infosimples-sync] ${result.casesQueried} caso(s) curado(s) consultado(s) (~R$${result.estimatedCostBrl.toFixed(2)}), ` +
      `${result.found} encontrado(s) (${result.movementsFound} movimentação(ões)), ${result.notFound} não encontrado(s) ` +
      `(possível segredo de justiça/CNJ incorreto), ${result.networkErrors} falha(s) de rede.`
  )

  return result
}
