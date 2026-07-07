/**
 * InfoSimples → DESCOBERTA automática de processos por OAB (TJSP e-SAJ 1º grau).
 *
 * DESLIGADA POR PADRÃO desde 07/07/2026 (opt-in via
 * INFOSIMPLES_OAB_DISCOVERY_ENABLED=true — ver worker-registry.ts). Decisão do
 * Miguel: ele já tem a lista curada dos processos reais de execução penal do
 * escritório e cadastra manualmente (cliente + matrícula + CNJ). Varrer a OAB
 * inteira e cadastrar automaticamente o que passa no filtro `isExecucaoPenal`
 * classificava processo errado às vezes (ex.: "Ação Penal" vazou uma vez) e
 * gastava consultando processo que não é do escritório.
 *
 * Para o monitoramento do dia a dia dos casos JÁ CADASTRADOS, use
 * `case-infosimples-sync.ts` (busca por CNJ específico, nunca descobre caso
 * novo). Este arquivo (`infosimples-sync.ts`) fica disponível pra religar se o
 * Miguel quiser voltar a varrer a OAB por conta própria no futuro.
 *
 * Para cada OAB (perfis do inventário + INFOSIMPLES_OABS): pagina a busca por
 * OAB, filtra execução penal, e registra em massa via endpoint interno
 * (cria cliente=executado + caso + movimentações + pedido de autos).
 *
 * Custo: R$0,20/página × páginas × OABs. A OAB 206292 tem ~12 páginas → ~R$2,40
 * por rodada; 1x/dia ≈ R$72/mês. Sem token → desabilitado (aviso, sem crash).
 */

import { eq } from 'drizzle-orm'
import { oabProfiles, integrationConnectors } from '@execflow/db/schema'
import type { WorkersDb } from '../lib/db.ts'
import { createInfosimplesConfig, fetchTjspByOab } from '../integrations/infosimples-client.ts'
import {
  createInternalApiConfig,
  pushRegisterCases,
  pushBackfillAutosTasks,
  type DiscoveredProcessPayload,
} from '../integrations/internal-api-client.ts'

const PAGE_THROTTLE_MS = 800
// Teto de páginas por OAB (controle de custo). Override: INFOSIMPLES_MAX_PAGES.
const MAX_PAGES = Number(process.env['INFOSIMPLES_MAX_PAGES'] ?? '20') || 20

export type InfosimplesSyncResult = {
  oabsQueried: number
  pagesFetched: number
  processesFound: number
  execPenalProcesses: number
  casesCreated: number
  casesArchived: number
  clientsCreated: number
  movementsInserted: number
  autosTasksCreated: number
  estimatedCostBrl: number
  networkErrors: number
  error: string | null
}

/**
 * Só EXECUÇÃO PENAL de verdade. Exclui, de propósito:
 *   - Ação Penal / inquérito (é conhecimento, não execução)
 *   - Execução Fiscal, Execução de Título, Cumprimento de Sentença (cível)
 *   - Alimentos, Fazenda Pública, etc.
 * Aceita: "Execução da Pena", "Execução Criminal/Penal", medida de segurança,
 * ou vara/foro claramente de execução criminal (DEECRIM / VEC).
 */
function isExecucaoPenal(classe: string | null, assunto: string | null, vara: string | null, foro: string | null): boolean {
  const norm = (s: string | null) =>
    (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const cls = norm(classe)
  const ctx = `${cls} ${norm(assunto)}`
  const local = `${norm(vara)} ${norm(foro)}`

  // Exclusões fortes (cível / conhecimento) — mesmo que contenham "execução".
  if (/(execucao fiscal|execucao de titulo|extrajudicial|cumprimento de sentenca|alimentos|fazenda|quantia certa|ipva|iptu|tributar)/.test(ctx)) {
    return false
  }
  if (/^acao penal|acao penal de|inquerito|procedimento (investigat|comum|especial)/.test(cls)) {
    return false
  }

  // Inclusões: classe é execução penal, OU a vara é claramente de execução criminal.
  const classePenal = /execucao (da pena|criminal|penal|da medida|de medida|provisoria)/.test(cls)
  const varaPenal = /(deecrim|execucao criminal|execucoes criminais|vec\b|vara das execucoes)/.test(local)
  return classePenal || (varaPenal && /execu/.test(cls))
}

export async function runInfosimplesSync(db: WorkersDb): Promise<InfosimplesSyncResult> {
  const result: InfosimplesSyncResult = {
    oabsQueried: 0,
    pagesFetched: 0,
    processesFound: 0,
    execPenalProcesses: 0,
    casesCreated: 0,
    casesArchived: 0,
    clientsCreated: 0,
    movementsInserted: 0,
    autosTasksCreated: 0,
    estimatedCostBrl: 0,
    networkErrors: 0,
    error: null,
  }

  const info = createInfosimplesConfig()
  const internal = createInternalApiConfig()
  if (!info) {
    result.error = 'INFOSIMPLES_TOKEN ausente'
    await recordConnector(db, result)
    return result
  }
  if (!internal) {
    result.error = 'EXECFLOW_API_URL/INTERNAL_API_TOKEN ausentes'
    await recordConnector(db, result)
    return result
  }

  // OABs: perfis + fallback env
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
  const oabs = [...profiles, ...envOabs].filter((o) => {
    const k = `${o.numero}/${o.uf}`.toUpperCase()
    if (!o.numero || seen.has(k)) return false
    seen.add(k)
    return true
  })

  if (oabs.length === 0) {
    result.error = 'Nenhuma OAB configurada (perfil em /inventory ou INFOSIMPLES_OABS no .env).'
    await recordConnector(db, result)
    return result
  }

  try {
    for (const oab of oabs) {
      result.oabsQueried++
      let page = 1
      let totalPages = 1

      do {
        const res = await fetchTjspByOab(info, oab.numero, page)
        await new Promise((r) => setTimeout(r, PAGE_THROTTLE_MS))

        if (res.networkError) {
          result.networkErrors++
          break
        }
        // 612 = nada encontrado nesta OAB; outros códigos !=200 → para essa OAB
        if (!res.ok) {
          if (res.code !== 612) console.warn(`[infosimples-sync] OAB ${oab.numero}: code ${res.code} ${res.message}`)
          break
        }

        result.pagesFetched++
        result.estimatedCostBrl += 0.2
        totalPages = res.totalPages
        result.processesFound += res.processes.length

        // Filtra execução penal e monta o payload de registro
        const payload: DiscoveredProcessPayload[] = res.processes
          .filter((p) => isExecucaoPenal(p.classe, p.assunto, p.vara, p.foro))
          .map((p) => ({
            cnj: p.processo,
            clientName: p.clientName,
            courtName: p.vara,
            jurisdiction: p.foro,
            classe: p.classe,
            source: 'infosimples',
            movements: p.movimentacoes.map((m) => ({ data: m.data, texto: m.movimento })),
          }))
        result.execPenalProcesses += payload.length

        // Registra em lotes de 50 (limite do endpoint)
        for (let i = 0; i < payload.length; i += 50) {
          const chunk = payload.slice(i, i + 50)
          const reg = await pushRegisterCases(internal, chunk)
          if (reg) {
            result.casesCreated += reg.casesCreated
            result.casesArchived += reg.casesArchived
            result.clientsCreated += reg.clientsCreated
            result.movementsInserted += reg.movementsInserted
            result.autosTasksCreated += reg.autosTasksCreated
          }
        }

        page++
      } while (page <= totalPages && page <= MAX_PAGES)
    }

    if (result.networkErrors > 0 && result.processesFound === 0) {
      result.error = `InfoSimples inacessível (${result.networkErrors} falha(s))`
    }

    console.info(
      `[infosimples-sync] ${result.error ? '⚠️' : '✅'} ${result.oabsQueried} OAB(s), ${result.pagesFetched} pág. ` +
        `(~R$${result.estimatedCostBrl.toFixed(2)}), ${result.execPenalProcesses} exec. penal, ` +
        `${result.casesCreated} caso(s) novo(s), ${result.casesArchived} arquivado(s), ${result.autosTasksCreated} pedido(s) de autos.`
    )
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error('[infosimples-sync] Falha:', err)
  }

  // Garante o pedido de autos em TODO caso sem autos (inclui pré-existentes).
  await pushBackfillAutosTasks(internal)

  await recordConnector(db, result)
  return result
}

async function recordConnector(db: WorkersDb, result: InfosimplesSyncResult): Promise<void> {
  try {
    const now = new Date()
    const ok = result.error === null
    // Semeia o conector se não existir (a tela de Integrações lê daqui)
    const [existing] = await db
      .select()
      .from(integrationConnectors)
      .where(eq(integrationConnectors.kind, 'infosimples'))
      .limit(1)
    if (!existing) return
    await db
      .update(integrationConnectors)
      .set({
        lastRunAt: now,
        hasCredential: true,
        ...(ok ? { lastSuccessAt: now, status: 'connected' } : { status: 'auth_error' }),
        lastError: result.error,
        recordsImported: existing.recordsImported + result.casesCreated,
        recordsUpdated: existing.recordsUpdated + result.movementsInserted,
        updatedAt: now,
      })
      .where(eq(integrationConnectors.id, existing.id))
  } catch (e) {
    console.warn('[infosimples-sync] Falha ao registrar conector:', e)
  }
}
