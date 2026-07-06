/**
 * DJEN → intimações por OAB. Puxa as intimações oficiais das OABs do escritório
 * e envia à reanálise: se o processo já é um caso, dispara alerta/prazo/oportunidade;
 * se não, vira intimação órfã na triagem (/intimations). Nada se perde.
 *
 * Fonte das OABs: os perfis cadastrados em oab_profiles (tela Inventário) +
 * fallback DJEN_OABS no .env. Grátis, sem CNPJ, sem chave.
 */

import { eq } from 'drizzle-orm'
import { oabProfiles, integrationConnectors } from '@execflow/db/schema'
import type { WorkersDb } from '../lib/db.ts'
import {
  fetchDjenIntimacoes,
  parseDjenOabsFromEnv,
  isDjenEnabled,
  type DjenOab,
} from '../integrations/djen-client.ts'
import {
  createInternalApiConfig,
  pushCaseMovements,
  type InternalMovementItem,
} from '../integrations/internal-api-client.ts'

const THROTTLE_MS = 500

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

  try {
    for (const oab of oabs) {
      result.oabsQueried++
      const q = await fetchDjenIntimacoes(oab, { days: 7, maxItems: 100 })
      await new Promise((r) => setTimeout(r, THROTTLE_MS))
      if (q.networkError) {
        result.networkErrors++
        continue
      }
      result.intimacoesFound += q.intimacoes.length

      // Agrupa por processo (uma chamada de reanálise por CNJ)
      const byCnj = new Map<string, typeof q.intimacoes>()
      for (const it of q.intimacoes) {
        const arr = byCnj.get(it.processNumber) ?? []
        arr.push(it)
        byCnj.set(it.processNumber, arr)
      }

      for (const [cnj, intimacoes] of byCnj) {
        const movements: InternalMovementItem[] = intimacoes.map((it) => ({
          tipo: it.tipoComunicacao,
          conteudo: it.texto,
          occurredAt: it.dataDisponibilizacao.toISOString(),
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
    }

    if (result.networkErrors > 0 && result.intimacoesFound === 0) {
      result.error = `DJEN inacessível (${result.networkErrors} falha(s) de rede)`
    }

    console.info(
      `[djen-sync] ${result.error ? '⚠️' : '✅'} ${result.oabsQueried} OAB(s), ` +
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
