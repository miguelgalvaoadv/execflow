/**
 * DJEN → intimações por OAB. Puxa as intimações oficiais das OABs do escritório
 * e envia à reanálise: se o processo já é um caso, dispara alerta/prazo/oportunidade;
 * se não, vira intimação órfã na triagem (/intimations). Nada se perde.
 *
 * Fonte das OABs: os perfis cadastrados em oab_profiles (tela Inventário) +
 * fallback DJEN_OABS no .env. Grátis, sem CNPJ, sem chave.
 *
 * MUDANÇA 06/07/2026: o endpoint filtrado por OAB (`/api/v1/comunicacao`) passou
 * a ser bloqueado por proteção anti-bot (testado de 3 redes diferentes — todas
 * bloqueadas). Trocado pelo endpoint de CADERNO diário (`/api/v1/caderno`), que
 * baixa o Diário do dia inteiro (ZIP) e filtra localmente pelas OABs — mais
 * pesado, mas funciona (testado ao vivo com resultados reais). Roda 1x/dia,
 * olhando os últimos DJEN_CADERNO_LOOKBACK_DAYS dias — dedup por hash evita
 * reprocessar.
 *
 * ATUALIZAÇÃO 12/07/2026: padrão subiu de 3 pra 6 dias. Testado ao vivo: o
 * CNJ demorou ~3 dias pra marcar um caderno como "Processado" (07/10 ok,
 * 07/11 e 07/12 ainda 404 "não encontrado" na mesma checagem). Com
 * lookback=3, um dia só entra na janela de checagem uma vez bem na borda —
 * se o atraso variar (feriado, pico de volume, etc.) um dia inteiro pode
 * nunca cair dentro de nenhuma janela e sumir pra sempre, sem erro nenhum
 * pra avisar (dedup por hash generalizado). 6 dias dá margem confortável
 * sem custo real (é grátis; dias "ainda não prontos" só custam 1 request
 * pequena de metadado, o ZIP grande só baixa quando o dia está pronto).
 */

import { eq } from 'drizzle-orm'
import { oabProfiles, integrationConnectors } from '@execflow/db/schema'
import type { WorkersDb } from '../lib/db.ts'
import { parseDjenOabsFromEnv, isDjenEnabled, type DjenOab } from '../integrations/djen-client.ts'
import { fetchCadernoIntimacoes } from '../integrations/djen-caderno-client.ts'
import {
  createInternalApiConfig,
  pushCaseMovements,
  type InternalMovementItem,
} from '../integrations/internal-api-client.ts'

const LOOKBACK_DAYS = Number(process.env['DJEN_CADERNO_LOOKBACK_DAYS'] ?? '6') || 6
const TRIBUNAIS = (process.env['DJEN_CADERNO_TRIBUNAIS'] ?? 'TJSP')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

export type DjenSyncResult = {
  oabsQueried: number
  intimacoesFound: number
  matchedCases: number
  orphans: number
  markedStale: number
  opportunitiesCreated: number
  networkErrors: number
  error: string | null
}

export async function runDjenSync(db: WorkersDb): Promise<DjenSyncResult> {
  const result: DjenSyncResult = {
    oabsQueried: 0,
    intimacoesFound: 0,
    matchedCases: 0,
    orphans: 0,
    markedStale: 0,
    opportunitiesCreated: 0,
    networkErrors: 0,
    error: null,
  }

  if (!isDjenEnabled()) {
    result.error = 'DJEN_ENABLED=false'
    return result
  }

  const internal = createInternalApiConfig()
  if (!internal) {
    result.error = 'EXECFLOW_API_URL/INTERNAL_API_TOKEN ausentes'
    console.warn('[djen-sync]', result.error)
    await recordConnector(db, result)
    return result
  }

  // OABs: perfis do inventário + fallback do .env (dedup por número/UF)
  const profiles = await db
    .select({ numero: oabProfiles.oabNumber, uf: oabProfiles.oabUf })
    .from(oabProfiles)
  const seen = new Set<string>()
  const oabs: DjenOab[] = []
  for (const o of [...profiles, ...parseDjenOabsFromEnv()]) {
    const key = `${o.numero}/${o.uf}`.toUpperCase()
    if (o.numero && o.uf && !seen.has(key)) {
      seen.add(key)
      oabs.push({ numero: o.numero, uf: o.uf.toUpperCase() })
    }
  }

  if (oabs.length === 0) {
    result.error =
      'Nenhuma OAB configurada. Cadastre um perfil em /inventory ou defina DJEN_OABS no .env do worker.'
    console.warn('[djen-sync]', result.error)
    await recordConnector(db, result)
    return result
  }

  result.oabsQueried = oabs.length

  try {
    // Um caderno cobre TODAS as OABs de uma vez (filtro é local, não no servidor).
    const byCnj = new Map<string, { tipoComunicacao: string; texto: string; occurredAt: string; hash: string; link: string | null }[]>()
    const seenHash = new Set<string>()
    let anyOk = false

    for (const tribunal of TRIBUNAIS) {
      for (let i = 0; i < LOOKBACK_DAYS; i++) {
        const date = new Date(Date.now() - (i + 1) * 86_400_000) // ontem, anteontem, ...
        const q = await fetchCadernoIntimacoes(tribunal, date, oabs)
        if (q.networkError) {
          result.networkErrors++
          continue
        }
        if (q.notReady) continue
        anyOk = true
        for (const it of q.intimacoes) {
          if (seenHash.has(it.hash)) continue
          seenHash.add(it.hash)
          result.intimacoesFound++
          const arr = byCnj.get(it.processNumber) ?? []
          arr.push({
            tipoComunicacao: it.tipoComunicacao,
            texto: it.texto,
            occurredAt: it.dataDisponibilizacao.toISOString(),
            hash: it.hash,
            link: it.link,
          })
          byCnj.set(it.processNumber, arr)
        }
      }
    }

    for (const [cnj, intimacoes] of byCnj) {
      const movements: InternalMovementItem[] = intimacoes.map((it) => ({
        tipo: it.tipoComunicacao,
        conteudo: it.texto,
        occurredAt: it.occurredAt,
        source: 'djen',
        kind: 'intimacao',
        dedupKey: `djen:${it.hash}`,
        link: it.link,
      }))
      const ingest = await pushCaseMovements(internal, cnj, movements)
      if (ingest.matched && ingest.processed > 0) {
        result.matchedCases++
        result.opportunitiesCreated += ingest.opportunitiesCreated
        if (ingest.markedStale) result.markedStale++
      }
      result.orphans += ingest.orphaned
    }

    if (!anyOk && result.networkErrors > 0) {
      result.error = `DJEN inacessível (${result.networkErrors} falha(s) de rede)`
    }

    console.info(
      `[djen-sync] ${result.error ? '⚠️' : '✅'} ${result.oabsQueried} OAB(s), ${TRIBUNAIS.join(',')}, ` +
        `${result.intimacoesFound} intimação(ões), ${result.matchedCases} caso(s) atualizado(s), ` +
        `${result.orphans} órfã(s) p/ triagem, ${result.markedStale} "precisa de autos".`
    )
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error('[djen-sync] Falha:', err)
  }

  await recordConnector(db, result)
  return result
}

async function recordConnector(db: WorkersDb, result: DjenSyncResult): Promise<void> {
  try {
    const now = new Date()
    const ok = result.error === null
    const rows = await db
      .select()
      .from(integrationConnectors)
      .where(eq(integrationConnectors.kind, 'djen'))
    for (const conn of rows) {
      await db
        .update(integrationConnectors)
        .set({
          lastRunAt: now,
          hasCredential: true, // DJEN não exige credencial — está sempre "apto"
          manualImportAvailable: false,
          ...(ok ? { lastSuccessAt: now, status: 'connected' } : { status: 'auth_error' }),
          lastError: result.error,
          recordsImported: conn.recordsImported + result.intimacoesFound,
          updatedAt: now,
        })
        .where(eq(integrationConnectors.id, conn.id))
    }
  } catch (e) {
    console.warn('[djen-sync] Falha ao registrar conector:', e)
  }
}
