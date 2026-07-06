/**
 * Enriquecimento diário do Inventário por OAB via DataJud (spec §5 fonte 4 + §23).
 *
 * Para cada item ativo do inventário com número CNJ válido:
 *   1. Consulta o DataJud (metadados públicos — nunca autos).
 *   2. Preenche APENAS campos vazios (classe, vara, tribunal, grau) —
 *      dado preenchido por humano nunca é sobrescrito.
 *   3. Atualiza a última movimentação se a do DataJud for mais nova.
 *   4. Reclassifica a prioridade com o classificador determinístico compartilhado.
 *
 * Estado honesto: cada rodada atualiza integration_connectors (kind='datajud')
 * com lastRun/lastSuccess/contadores — é o que a tela de Integrações exibe.
 */

import { eq, and, notInArray } from 'drizzle-orm'
import { inventoryItems, integrationConnectors, oabProfiles } from '@execflow/db/schema'
import { classifyInventoryItem } from '@execflow/engine'
import type { WorkersDb } from '../lib/db.ts'
import {
  createDatajudConfig,
  fetchDatajudProcess,
  datajudAliasFromCnj,
} from '../integrations/datajud-client.ts'

/** Pausa entre consultas — respeito ao rate limit público do CNJ. */
const THROTTLE_MS = 250

export type InventoryEnrichmentResult = {
  evaluated: number
  enriched: number
  notFound: number
  networkErrors: number
  reclassified: number
  skippedNoAlias: number
  error: string | null
}

export async function runInventoryEnrichment(db: WorkersDb): Promise<InventoryEnrichmentResult> {
  const result: InventoryEnrichmentResult = {
    evaluated: 0,
    enriched: 0,
    notFound: 0,
    networkErrors: 0,
    reclassified: 0,
    skippedNoAlias: 0,
    error: null,
  }

  const config = createDatajudConfig()
  if (!config) {
    console.warn('[inventory-enrichment] DATAJUD_API_KEY ausente — enriquecimento desabilitado.')
    result.error = 'DATAJUD_API_KEY ausente'
    await recordConnectorRun(db, result)
    return result
  }

  try {
    const items = await db
      .select()
      .from(inventoryItems)
      .where(notInArray(inventoryItems.reviewStatus, ['not_ours', 'archived']))

    for (const item of items) {
      result.evaluated++

      if (datajudAliasFromCnj(item.processNumber) === null) {
        result.skippedNoAlias++
        continue
      }

      const info = await fetchDatajudProcess(config, item.processNumber)
      await new Promise((r) => setTimeout(r, THROTTLE_MS))

      if (!info.found) {
        if (info.networkError) result.networkErrors++
        else result.notFound++
        continue
      }

      // Preencher só o que está vazio; movimentação só se for mais nova.
      const fill: Record<string, unknown> = {}
      if (info.tribunal && !item.tribunal) fill['tribunal'] = info.tribunal
      if (info.degree && !item.degree) fill['degree'] = info.degree
      if (info.courtClass && !item.courtClass) fill['courtClass'] = info.courtClass
      if (info.vara && !item.vara) fill['vara'] = info.vara
      // nivelSigilo > 0 na base nacional → marca segredo automaticamente
      // (só LIGA; nunca desliga uma marcação manual do advogado).
      if (info.isSealed && !item.isSealed) fill['isSealed'] = true

      const isNewerMovement =
        info.lastMovementAt !== null &&
        (item.lastMovementAt === null || info.lastMovementAt > item.lastMovementAt)
      if (isNewerMovement) {
        fill['lastMovementText'] = info.lastMovementText
        fill['lastMovementAt'] = info.lastMovementAt
      }

      const merged = {
        ...item,
        ...(fill as Partial<typeof item>),
      }
      const classification = classifyInventoryItem(merged)
      const classificationChanged =
        classification.priority !== item.priority ||
        classification.needsAutos !== item.needsAutos

      if (Object.keys(fill).length === 0 && !classificationChanged) continue

      await db
        .update(inventoryItems)
        .set({
          ...fill,
          priority: classification.priority,
          priorityReason: classification.priorityReason,
          needsAutos: classification.needsAutos,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, item.id))

      result.enriched++
      if (classificationChanged) result.reclassified++
    }

    // Marca perfis como sincronizados nesta rodada.
    await db
      .update(oabProfiles)
      .set({ searchStatus: 'synced', lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(oabProfiles.searchSource, 'datajud'))

    // Honestidade: falha de rede generalizada NÃO é "consultei e não achei".
    if (result.networkErrors > 0 && result.enriched === 0 && result.notFound === 0) {
      result.error = `API DataJud inacessível (${result.networkErrors} falha(s) de rede/timeout)`
    }

    console.info(
      `[inventory-enrichment] ${result.error ? '⚠️' : '✅'} ${result.evaluated} avaliado(s), ${result.enriched} enriquecido(s), ${result.notFound} não encontrado(s), ${result.networkErrors} erro(s) de rede, ${result.skippedNoAlias} sem alias.`
    )
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error('[inventory-enrichment] Falha na rodada:', err)
  }

  await recordConnectorRun(db, result)
  return result
}

/** Grava o estado da rodada no conector 'datajud' (fonte da tela de Integrações). */
async function recordConnectorRun(db: WorkersDb, result: InventoryEnrichmentResult): Promise<void> {
  try {
    const now = new Date()
    const succeeded = result.error === null
    const connectors = await db
      .select()
      .from(integrationConnectors)
      .where(eq(integrationConnectors.kind, 'datajud'))

    for (const conn of connectors) {
      await db
        .update(integrationConnectors)
        .set({
          lastRunAt: now,
          ...(succeeded ? { lastSuccessAt: now, status: 'connected', hasCredential: true } : {}),
          lastError: result.error,
          recordsUpdated: conn.recordsUpdated + result.enriched,
          updatedAt: now,
        })
        .where(eq(integrationConnectors.id, conn.id))
    }
  } catch (err) {
    console.warn('[inventory-enrichment] Falha ao registrar conector:', err)
  }
}
