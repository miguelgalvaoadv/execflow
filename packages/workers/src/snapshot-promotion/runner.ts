/**
 * Snapshot promotion runner — document.confirmed → snapshot proposed → confirmed.
 */

import { randomUUID } from 'node:crypto'
import { eq, and, desc } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'
import {
  SNAPSHOT_PROMOTION_REQUESTED,
  SNAPSHOT_PROPOSED,
  SNAPSHOT_CONFIRMED,
  assertSnapshotPromotionRow,
  assertDocumentExtractionResultRow,
} from '@execflow/db/types'
import { resolvePromotionKind } from './rules.ts'
import { mapStructuredDataToSnapshotProposal } from './mapper.ts'
import { upsertQueueProjection } from '../projections/queue-projection.ts'

const SYSTEM_ACTOR_ID = 'snapshot-promotion.worker'

export type RequestSnapshotPromotionParams = {
  organizationId: string
  documentId: string
  triggerEventId: string
  correlationId: string
  promotedByUserId: string | null
}

/** Schedules promotion from confirmed document + extraction (idempotent on triggerEventId). */
export async function requestSnapshotPromotion(
  db: WorkersDb,
  params: RequestSnapshotPromotionParams
): Promise<string | null> {
  const {
    documents,
    extractionRuns,
    documentExtractionResults,
    snapshotPromotions,
    domainEvents,
  } = await import('@execflow/db/schema')

  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.id, params.documentId), eq(documents.organizationId, params.organizationId))
    )
    .limit(1)

  if (doc === undefined) return null
  if (doc.status !== 'confirmed') return null
  if (doc.executionCaseId === null) return null

  const [run] = await db
    .select()
    .from(extractionRuns)
    .where(
      and(
        eq(extractionRuns.documentId, doc.id),
        eq(extractionRuns.organizationId, params.organizationId),
        eq(extractionRuns.status, 'confirmed')
      )
    )
    .orderBy(desc(extractionRuns.createdAt))
    .limit(1)

  if (run === undefined) return null

  const [result] = await db
    .select()
    .from(documentExtractionResults)
    .where(eq(documentExtractionResults.extractionRunId, run.id))
    .limit(1)

  if (result === undefined) return null

  assertDocumentExtractionResultRow(result, `requestSnapshotPromotion(${doc.id})`)

  const snapshotKind = resolvePromotionKind({
    extractionType: run.extractionType,
    documentClass: doc.documentClass,
  })

  if (snapshotKind === null) return null

  const now = new Date()

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: snapshotPromotions.id })
      .from(snapshotPromotions)
      .where(
        and(
          eq(snapshotPromotions.sourceDocumentId, doc.id),
          eq(snapshotPromotions.triggerEventId, params.triggerEventId)
        )
      )
      .limit(1)

    if (existing[0] !== undefined) {
      return existing[0].id
    }

    const promotionId = randomUUID()
    const eventId = randomUUID()

    await tx.insert(snapshotPromotions).values({
      id: promotionId,
      organizationId: params.organizationId,
      sourceDocumentId: doc.id,
      extractionRunId: run.id,
      executionCaseId: doc.executionCaseId!,
      snapshotKind,
      status: 'requested',
      extractionType: run.extractionType,
      promotedByUserId: params.promotedByUserId,
      promotedAt: now,
      triggerEventId: params.triggerEventId,
      correlationId: params.correlationId,
    })

    await tx.insert(domainEvents).values({
      id: eventId,
      eventType: SNAPSHOT_PROMOTION_REQUESTED,
      aggregateType: 'SnapshotPromotion',
      aggregateId: promotionId,
      organizationId: params.organizationId,
      actorType: 'system',
      actorId: SYSTEM_ACTOR_ID,
      occurredAt: now,
      recordedAt: now,
      correlationId: params.correlationId,
      causationId: params.triggerEventId,
      payload: {
        promotionId,
        sourceDocumentId: doc.id,
        extractionRunId: run.id,
        executionCaseId: doc.executionCaseId,
        organizationId: params.organizationId,
        snapshotKind,
        extractionType: run.extractionType,
      },
      processingStatus: 'pending',
      replayable: true,
    })

    return promotionId
  })
}

export type ExecuteSnapshotPromotionParams = {
  promotionId: string
  organizationId: string
  correlationId: string | null
  causationEventId: string | null
}

/** Proposes snapshot from extraction result; emits snapshot.proposed. */
export async function executeSnapshotPromotion(
  db: WorkersDb,
  params: ExecuteSnapshotPromotionParams
): Promise<void> {
  const {
    snapshotPromotions,
    documentExtractionResults,
    sentenceSnapshots,
    custodySnapshots,
    domainEvents,
  } = await import('@execflow/db/schema')

  const [promotion] = await db
    .select()
    .from(snapshotPromotions)
    .where(
      and(
        eq(snapshotPromotions.id, params.promotionId),
        eq(snapshotPromotions.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (promotion === undefined) return
  assertSnapshotPromotionRow(promotion, `executeSnapshotPromotion(${params.promotionId})`)
  if (promotion.status === 'proposed' || promotion.status === 'confirmed') return
  if (promotion.status === 'skipped' || promotion.status === 'failed') return

  const [result] = await db
    .select()
    .from(documentExtractionResults)
    .where(eq(documentExtractionResults.extractionRunId, promotion.extractionRunId))
    .limit(1)

  if (result === undefined) {
    await markPromotionFailed(db, promotion.id, params.organizationId, 'Extraction result not found.')
    return
  }

  assertDocumentExtractionResultRow(result, `executeSnapshotPromotion(${params.promotionId})`)

  const mapped = mapStructuredDataToSnapshotProposal({
    snapshotKind: promotion.snapshotKind as 'sentence' | 'custody',
    structuredData: result.structuredData as Record<string, unknown>,
    sourceDocumentId: promotion.sourceDocumentId,
    extractedAt: result.extractedAt,
    defaultConfidence: result.confidence,
  })

  if ('error' in mapped) {
    await markPromotionFailed(db, promotion.id, params.organizationId, mapped.error)
    return
  }

  const correlationId = params.correlationId ?? promotion.correlationId ?? randomUUID()
  const now = new Date()
  const snapshotId = randomUUID()

  await db.transaction(async (tx) => {
    if (mapped.kind === 'sentence') {
      await tx.insert(sentenceSnapshots).values({
        id: snapshotId,
        organizationId: params.organizationId,
        executionCaseId: promotion.executionCaseId,
        effectiveAt: mapped.effectiveAt,
        status: 'proposed',
        totalSentenceDays: mapped.arithmetic.totalSentenceDays,
        servedDays: mapped.arithmetic.servedDays,
        remissionDays: mapped.arithmetic.remissionDays,
        detractionDays: mapped.arithmetic.detractionDays,
        remainingDays: mapped.remainingDays,
        percentServed: mapped.percentServed,
        confidenceLevel: mapped.confidenceLevel,
        calculationMethod: 'extraction_promotion',
        sourceDocumentIds: mapped.sourceDocumentIds,
        explanation: mapped.explanation,
        missingDataFlags: [],
        createdByUserId: promotion.promotedByUserId,
      })
    } else {
      await tx.insert(custodySnapshots).values({
        id: snapshotId,
        organizationId: params.organizationId,
        executionCaseId: promotion.executionCaseId,
        regime: mapped.regime,
        effectiveAt: mapped.effectiveAt,
        confidence: mapped.confidence,
        notes: mapped.notes,
      })
    }

    await tx
      .update(snapshotPromotions)
      .set({
        status: 'proposed',
        snapshotId,
        promotedAt: now,
      })
      .where(eq(snapshotPromotions.id, promotion.id))

    await tx.insert(domainEvents).values({
      id: randomUUID(),
      eventType: SNAPSHOT_PROPOSED,
      aggregateType: 'SnapshotPromotion',
      aggregateId: promotion.id,
      organizationId: params.organizationId,
      actorType: 'system',
      actorId: SYSTEM_ACTOR_ID,
      occurredAt: now,
      recordedAt: now,
      correlationId,
      causationId: params.causationEventId,
      payload: {
        promotionId: promotion.id,
        snapshotId,
        snapshotKind: promotion.snapshotKind,
        sourceDocumentId: promotion.sourceDocumentId,
        extractionRunId: promotion.extractionRunId,
        executionCaseId: promotion.executionCaseId,
        organizationId: params.organizationId,
        extractionType: promotion.extractionType,
      },
      processingStatus: 'pending',
      replayable: true,
    })
  })

  const entityType = promotion.snapshotKind === 'sentence' ? 'SentenceSnapshot' : 'CustodySnapshot'
  const slaDeadlineAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
  await upsertQueueProjection(db, {
    organizationId: params.organizationId,
    queueType: 'snapshot_review',
    entityType,
    entityId: snapshotId,
    executionCaseId: promotion.executionCaseId,
    priority: 2,
    displayTitle: `Snapshot para revisar: ${promotion.snapshotKind}`,
    slaDeadlineAt,
    ...(params.causationEventId !== null && params.causationEventId !== undefined
      ? { sourceCausingEventId: params.causationEventId }
      : {}),
    metadata: {
      promotionId: promotion.id,
      snapshotKind: promotion.snapshotKind,
      extractionRunId: promotion.extractionRunId,
      sourceDocumentId: promotion.sourceDocumentId,
    },
  })
}

async function markPromotionFailed(
  db: WorkersDb,
  promotionId: string,
  organizationId: string,
  message: string
): Promise<void> {
  const { snapshotPromotions } = await import('@execflow/db/schema')
  await db
    .update(snapshotPromotions)
    .set({ status: 'failed', errorMessage: message })
    .where(
      and(eq(snapshotPromotions.id, promotionId), eq(snapshotPromotions.organizationId, organizationId))
    )
}

export type ConfirmPromotedSnapshotParams = {
  promotionId: string
  organizationId: string
  confirmedByUserId: string
  correlationId?: string | null
  causationEventId?: string | null
}

/** Human confirmation of promoted snapshot — emits snapshot.confirmed (+ custody.snapshot.created for custody). */
export async function confirmPromotedSnapshot(
  db: WorkersDb,
  params: ConfirmPromotedSnapshotParams
): Promise<boolean> {
  const { snapshotPromotions, sentenceSnapshots, custodySnapshots, domainEvents } = await import(
    '@execflow/db/schema'
  )

  const [promotion] = await db
    .select()
    .from(snapshotPromotions)
    .where(
      and(
        eq(snapshotPromotions.id, params.promotionId),
        eq(snapshotPromotions.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (promotion === undefined || promotion.status !== 'proposed' || promotion.snapshotId === null) {
    return false
  }

  const confirmedAt = new Date()
  const correlationId = params.correlationId ?? promotion.correlationId ?? randomUUID()
  const snapshotKind = promotion.snapshotKind as 'sentence' | 'custody'
  let confirmed = false

  await db.transaction(async (tx) => {
    if (snapshotKind === 'sentence') {
      const updated = await tx
        .update(sentenceSnapshots)
        .set({
          status: 'confirmed',
          confirmedByUserId: params.confirmedByUserId,
          confirmedAt,
        })
        .where(
          and(
            eq(sentenceSnapshots.id, promotion.snapshotId!),
            eq(sentenceSnapshots.organizationId, params.organizationId),
            eq(sentenceSnapshots.status, 'proposed')
          )
        )
        .returning({ id: sentenceSnapshots.id })

      if (updated.length === 0) return
      confirmed = true
    } else {
      const updated = await tx
        .update(custodySnapshots)
        .set({
          confirmedByUserId: params.confirmedByUserId,
          confirmedAt,
        })
        .where(
          and(
            eq(custodySnapshots.id, promotion.snapshotId!),
            eq(custodySnapshots.organizationId, params.organizationId)
          )
        )
        .returning({ id: custodySnapshots.id, effectiveAt: custodySnapshots.effectiveAt, regime: custodySnapshots.regime })

      if (updated.length === 0) return
      confirmed = true

      await tx.insert(domainEvents).values({
        id: randomUUID(),
        eventType: 'custody.snapshot.created',
        aggregateType: 'CustodySnapshot',
        aggregateId: promotion.snapshotId!,
        organizationId: params.organizationId,
        actorType: 'user',
        actorId: params.confirmedByUserId,
        occurredAt: updated[0]!.effectiveAt,
        recordedAt: confirmedAt,
        correlationId,
        causationId: params.causationEventId ?? null,
        payload: {
          snapshotId: promotion.snapshotId,
          custodySnapshotId: promotion.snapshotId,
          executionCaseId: promotion.executionCaseId,
          organizationId: params.organizationId,
          regime: updated[0]!.regime,
        },
        processingStatus: 'pending',
        replayable: true,
      })
    }

    await tx
      .update(snapshotPromotions)
      .set({ status: 'confirmed', promotedAt: confirmedAt })
      .where(eq(snapshotPromotions.id, promotion.id))

    await tx.insert(domainEvents).values({
      id: randomUUID(),
      eventType: SNAPSHOT_CONFIRMED,
      aggregateType: snapshotKind === 'sentence' ? 'SentenceSnapshot' : 'CustodySnapshot',
      aggregateId: promotion.snapshotId!,
      organizationId: params.organizationId,
      actorType: 'user',
      actorId: params.confirmedByUserId,
      occurredAt: confirmedAt,
      recordedAt: confirmedAt,
      correlationId,
      causationId: params.causationEventId ?? null,
      payload: {
        promotionId: promotion.id,
        snapshotId: promotion.snapshotId,
        snapshotKind,
        executionCaseId: promotion.executionCaseId,
        organizationId: params.organizationId,
        confirmedByUserId: params.confirmedByUserId,
        status: 'confirmed',
      },
      processingStatus: 'pending',
      replayable: true,
    })
  })

  return confirmed
}
