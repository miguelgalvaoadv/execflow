/**
 * DataJud → CASO: traz movimentações públicas novas para os casos promovidos
 * e dispara a reanálise (alerta, oportunidades, stale/"precisa de autos").
 *
 * Diferente do inventory-enrichment (que só toca o inventário), este sync olha
 * os casos operacionais (execution_cases) com CNJ, busca a timeline pública no
 * DataJud, faz o DIFF contra o que já está no painel e envia SÓ as movimentações
 * novas ao endpoint interno da API — que roda a MESMA cadeia da webhook AASP.
 *
 * DataJud dá o METADADO ("Proferida sentença"), não o conteúdo da decisão — por
 * isso a cadeia marca "precisa de autos" quando a movimentação é crítica, em vez
 * de fingir que entende o mérito.
 */

import { eq, and, inArray } from 'drizzle-orm'
import { executionCases, timelineEvents, integrationConnectors } from '@execflow/db/schema'
import type { WorkersDb } from '../lib/db.ts'
import {
  createDatajudConfig,
  fetchDatajudMovements,
  datajudAliasFromCnj,
} from '../integrations/datajud-client.ts'
import {
  createInternalApiConfig,
  pushCaseMovements,
  type InternalMovementItem,
} from '../integrations/internal-api-client.ts'

const THROTTLE_MS = 300

export type DatajudCaseSyncResult = {
  casesEvaluated: number
  casesWithNewMovements: number
  newMovements: number
  markedStale: number
  opportunitiesCreated: number
  networkErrors: number
  error: string | null
}

export async function runDatajudCaseSync(db: WorkersDb): Promise<DatajudCaseSyncResult> {
  const result: DatajudCaseSyncResult = {
    casesEvaluated: 0,
    casesWithNewMovements: 0,
    newMovements: 0,
    markedStale: 0,
    opportunitiesCreated: 0,
    networkErrors: 0,
    error: null,
  }

  const datajud = createDatajudConfig()
  const internal = createInternalApiConfig()
  if (!datajud) {
    result.error = 'DATAJUD_API_KEY ausente'
    await recordConnector(db, result)
    return result
  }
  if (!internal) {
    result.error = 'EXECFLOW_API_URL/INTERNAL_API_TOKEN ausentes — worker não consegue disparar a reanálise'
    console.warn('[datajud-case-sync]', result.error)
    await recordConnector(db, result)
    return result
  }

  try {
    // Casos ativos com CNJ (fora encerrados/arquivados)
    const cases = await db
      .select()
      .from(executionCases)
      .where(inArray(executionCases.status, ['intake', 'active', 'suspended']))

    for (const execCase of cases) {
      const cnj = execCase.executionProcessNumber
      if (!cnj || datajudAliasFromCnj(cnj) === null) continue
      result.casesEvaluated++

      const dj = await fetchDatajudMovements(datajud, cnj)
      await new Promise((r) => setTimeout(r, THROTTLE_MS))
      if (dj.networkError) {
        result.networkErrors++
        continue
      }
      if (!dj.found || dj.movements.length === 0) continue

      // DIFF: quais movimentações do DataJud ainda não estão na timeline?
      // A timeline guarda o dedupKey embutido no summary ([datajud] …) OU
      // eventos antigos — comparamos por presença do dedupKey no summary.
      const existing = await db
        .select({ summary: timelineEvents.summary })
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.executionCaseId, execCase.id),
            eq(timelineEvents.source, 'integration')
          )
        )
      const existingText = existing.map((e) => e.summary).join('\n')

      // Envia só as movimentações cujo NOME ainda não aparece na timeline.
      // (A dedup final e definitiva é por contentHash no endpoint interno;
      // aqui é um pré-filtro barato para não chamar a IA à toa.)
      const novos = dj.movements.filter((m) => !existingText.includes(m.nome))
      if (novos.length === 0) continue

      const movements: InternalMovementItem[] = novos.map((m) => ({
        tipo: m.nome,
        conteudo: m.nome, // DataJud não traz o conteúdo, só o nome do movimento
        occurredAt: m.dataHora.toISOString(),
        source: 'datajud',
        kind: 'movimentacao',
        dedupKey: m.dedupKey,
      }))

      const ingest = await pushCaseMovements(internal, cnj, movements)
      if (ingest.processed > 0) {
        result.casesWithNewMovements++
        result.newMovements += ingest.processed
        result.opportunitiesCreated += ingest.opportunitiesCreated
        if (ingest.markedStale) result.markedStale++
      }
    }

    if (result.networkErrors > 0 && result.casesWithNewMovements === 0) {
      result.error = `DataJud inacessível (${result.networkErrors} falha(s) de rede)`
    }

    console.info(
      `[datajud-case-sync] ${result.error ? '⚠️' : '✅'} ${result.casesEvaluated} caso(s), ` +
        `${result.newMovements} movimentação(ões) nova(s), ${result.markedStale} marcado(s) "precisa de autos", ` +
        `${result.opportunitiesCreated} oportunidade(s).`
    )
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error('[datajud-case-sync] Falha:', err)
  }

  await recordConnector(db, result)
  return result
}

async function recordConnector(db: WorkersDb, result: DatajudCaseSyncResult): Promise<void> {
  try {
    const now = new Date()
    const ok = result.error === null
    const rows = await db
      .select()
      .from(integrationConnectors)
      .where(eq(integrationConnectors.kind, 'datajud'))
    for (const conn of rows) {
      await db
        .update(integrationConnectors)
        .set({
          lastRunAt: now,
          ...(ok ? { lastSuccessAt: now, status: 'connected', hasCredential: true } : {}),
          lastError: result.error,
          recordsUpdated: conn.recordsUpdated + result.newMovements,
          updatedAt: now,
        })
        .where(eq(integrationConnectors.id, conn.id))
    }
  } catch (e) {
    console.warn('[datajud-case-sync] Falha ao registrar conector:', e)
  }
}
