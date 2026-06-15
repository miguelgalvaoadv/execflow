/**
 * Extraction pipeline runner — structured data lifecycle + outbox events.
 */

import { randomUUID } from 'node:crypto'
import { eq, and, sql, max } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'
import type { ExtractionProvider } from '@execflow/extraction'
import { ExtractionProviderError } from '@execflow/extraction'
import {
  EXTRACTION_REQUESTED,
  EXTRACTION_RUNNING,
  EXTRACTION_REVIEW,
  EXTRACTION_CONFIRMED,
  EXTRACTION_FAILED,
  DOCUMENT_CONFIRMED,
  buildDocumentConfirmedPayload,
} from '@execflow/db/types'
import { assertDocumentExtractionResultRow } from '@execflow/db/types'
import { upsertQueueProjection, resolveQueueProjection } from '../projections/queue-projection.ts'

const SYSTEM_ACTOR_ID = 'extraction.worker'

export type ScheduleExtractionForDocumentParams = {
  organizationId: string
  documentId: string
  ocrRunId: string
  ocrResultId: string
  triggerEventId: string
  correlationId: string
  providerId: string
  extractionType: string
  maxAttempts: number
}

/** Creates extraction_run + extraction.requested outbox event (idempotent on triggerEventId). */
export async function scheduleExtractionForDocument(
  db: WorkersDb,
  params: ScheduleExtractionForDocumentParams
): Promise<string | null> {
  const { extractionRuns, domainEvents } = await import('@execflow/db/schema')
  const now = new Date()

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: extractionRuns.id })
      .from(extractionRuns)
      .where(
        and(
          eq(extractionRuns.documentId, params.documentId),
          eq(extractionRuns.triggerEventId, params.triggerEventId)
        )
      )
      .limit(1)

    if (existing[0] !== undefined) {
      return existing[0].id
    }

    const [maxRow] = await tx
      .select({ value: max(extractionRuns.runNumber) })
      .from(extractionRuns)
      .where(eq(extractionRuns.documentId, params.documentId))

    const runNumber = (maxRow?.value ?? 0) + 1
    const extractionRunId = randomUUID()
    const eventId = randomUUID()

    await tx.insert(extractionRuns).values({
      id: extractionRunId,
      organizationId: params.organizationId,
      documentId: params.documentId,
      ocrRunId: params.ocrRunId,
      ocrResultId: params.ocrResultId,
      runNumber,
      status: 'requested',
      extractionType: params.extractionType,
      providerId: params.providerId,
      attemptCount: 0,
      maxAttempts: params.maxAttempts,
      triggerEventId: params.triggerEventId,
      correlationId: params.correlationId,
    })

    await tx.insert(domainEvents).values({
      id: eventId,
      eventType: EXTRACTION_REQUESTED,
      aggregateType: 'ExtractionRun',
      aggregateId: extractionRunId,
      organizationId: params.organizationId,
      actorType: 'system',
      actorId: SYSTEM_ACTOR_ID,
      occurredAt: now,
      recordedAt: now,
      correlationId: params.correlationId,
      causationId: params.triggerEventId,
      payload: {
        extractionRunId,
        documentId: params.documentId,
        organizationId: params.organizationId,
        ocrRunId: params.ocrRunId,
        ocrResultId: params.ocrResultId,
        providerId: params.providerId,
        extractionType: params.extractionType,
        runNumber,
        attemptNumber: 1,
      },
      processingStatus: 'pending',
      replayable: true,
    })

    return extractionRunId
  })
}

export type ExecuteExtractionRunParams = {
  extractionRunId: string
  organizationId: string
  correlationId: string | null
  causationEventId: string | null
}

/** Runs extraction for an existing extraction_run; persists append-only structured result. */
export async function executeExtractionRun(
  db: WorkersDb,
  provider: ExtractionProvider,
  params: ExecuteExtractionRunParams
): Promise<void> {
  const { extractionRuns, documents, documentOcrResults, documentExtractionResults, domainEvents } =
    await import('@execflow/db/schema')

  const [run] = await db
    .select()
    .from(extractionRuns)
    .where(
      and(
        eq(extractionRuns.id, params.extractionRunId),
        eq(extractionRuns.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (run === undefined) return
  if (run.status === 'review' || run.status === 'confirmed') return
  if (run.status === 'failed' && run.attemptCount >= run.maxAttempts) return

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, run.documentId), eq(documents.organizationId, params.organizationId)))
    .limit(1)

  if (doc === undefined) return
  if (doc.ocrStatus !== 'completed') return

  const [ocrResult] = await db
    .select()
    .from(documentOcrResults)
    .where(
      and(
        eq(documentOcrResults.id, run.ocrResultId),
        eq(documentOcrResults.documentId, run.documentId)
      )
    )
    .limit(1)

  if (ocrResult === undefined) return

  const attemptNumber = run.attemptCount + 1
  const now = new Date()
  const correlationId = params.correlationId ?? run.correlationId ?? randomUUID()

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(extractionRuns)
      .set({
        status: 'running',
        attemptCount: attemptNumber,
        startedAt: now,
        errorMessage: null,
      })
      .where(
        and(
          eq(extractionRuns.id, run.id),
          sql`${extractionRuns.status} IN ('requested', 'failed')`
        )
      )
      .returning({ id: extractionRuns.id })

    if (updated.length === 0) return

    await tx
      .update(documents)
      .set({ status: 'extraction_running', updatedAt: now })
      .where(and(eq(documents.id, doc.id), eq(documents.organizationId, params.organizationId)))

    await tx.insert(domainEvents).values({
      id: randomUUID(),
      eventType: EXTRACTION_RUNNING,
      aggregateType: 'ExtractionRun',
      aggregateId: run.id,
      organizationId: params.organizationId,
      actorType: 'system',
      actorId: SYSTEM_ACTOR_ID,
      occurredAt: now,
      recordedAt: now,
      correlationId,
      causationId: params.causationEventId,
      payload: {
        extractionRunId: run.id,
        documentId: doc.id,
        organizationId: params.organizationId,
        attemptNumber,
      },
      processingStatus: 'pending',
      replayable: true,
    })
  })

  try {
    const extracted = await provider.extractStructured({
      documentId: doc.id,
      organizationId: doc.organizationId,
      extractionType: run.extractionType,
      rawText: ocrResult.rawText,
      ocrResultId: ocrResult.id,
      ocrRunId: run.ocrRunId,
      documentClass: doc.documentClass,
    })

    const extractedAt = new Date()
    const resultId = randomUUID()

    assertDocumentExtractionResultRow(
      { structuredData: extracted.structuredData, confidence: extracted.confidence },
      `executeExtractionRun(${run.id})`
    )

    await db.transaction(async (tx) => {
      await tx.insert(documentExtractionResults).values({
        id: resultId,
        organizationId: params.organizationId,
        documentId: doc.id,
        extractionRunId: run.id,
        extractionType: run.extractionType,
        structuredData: extracted.structuredData,
        confidence: extracted.confidence,
        providerMetadata: extracted.providerMetadata,
        extractedAt,
      })

      await tx
        .update(extractionRuns)
        .set({ status: 'review', completedAt: extractedAt, errorMessage: null })
        .where(eq(extractionRuns.id, run.id))

      await tx
        .update(documents)
        .set({ status: 'extraction_review', updatedAt: extractedAt })
        .where(eq(documents.id, doc.id))

      await tx.insert(domainEvents).values({
        id: randomUUID(),
        eventType: EXTRACTION_REVIEW,
        aggregateType: 'ExtractionRun',
        aggregateId: run.id,
        organizationId: params.organizationId,
        actorType: 'system',
        actorId: SYSTEM_ACTOR_ID,
        occurredAt: extractedAt,
        recordedAt: extractedAt,
        correlationId,
        causationId: params.causationEventId,
        payload: {
          extractionRunId: run.id,
          documentId: doc.id,
          organizationId: params.organizationId,
          providerId: provider.id,
          extractionType: run.extractionType,
          resultId,
          confidence: extracted.confidence,
        },
        processingStatus: 'pending',
        replayable: true,
      })
    })

    const slaDeadlineAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    await upsertQueueProjection(db, {
      organizationId: params.organizationId,
      queueType: 'extraction_review',
      entityType: 'Document',
      entityId: doc.id,
      ...(doc.executionCaseId !== null ? { executionCaseId: doc.executionCaseId } : {}),
      priority: 2,
      displayTitle: `Extração para revisar: ${doc.documentClass ?? 'document'}`,
      ...(doc.documentClass !== null ? { displayLabel: doc.documentClass } : {}),
      slaDeadlineAt,
      ...(params.causationEventId !== null && params.causationEventId !== undefined
        ? { sourceCausingEventId: params.causationEventId }
        : {}),
      metadata: {
        extractionRunId: run.id,
        documentClass: doc.documentClass,
        documentStatus: 'extraction_review',
        confidence: extracted.confidence,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const retryable = err instanceof ExtractionProviderError ? err.retryable : true
    const failedAt = new Date()

    await db.transaction(async (tx) => {
      const finalFailure = attemptNumber >= run.maxAttempts || !retryable

      await tx
        .update(extractionRuns)
        .set({
          status: finalFailure ? 'failed' : 'requested',
          completedAt: finalFailure ? failedAt : null,
          errorMessage: message,
        })
        .where(eq(extractionRuns.id, run.id))

      if (finalFailure) {
        await tx
          .update(documents)
          .set({ status: 'pending_extraction', updatedAt: failedAt })
          .where(eq(documents.id, doc.id))
      }

      await tx.insert(domainEvents).values({
        id: randomUUID(),
        eventType: EXTRACTION_FAILED,
        aggregateType: 'ExtractionRun',
        aggregateId: run.id,
        organizationId: params.organizationId,
        actorType: 'system',
        actorId: SYSTEM_ACTOR_ID,
        occurredAt: failedAt,
        recordedAt: failedAt,
        correlationId,
        causationId: params.causationEventId,
        payload: {
          extractionRunId: run.id,
          documentId: doc.id,
          organizationId: params.organizationId,
          providerId: provider.id,
          attemptNumber,
          retryable: !finalFailure,
          errorMessage: message,
        },
        processingStatus: 'pending',
        replayable: true,
      })

      if (!finalFailure) {
        await tx.insert(domainEvents).values({
          id: randomUUID(),
          eventType: EXTRACTION_REQUESTED,
          aggregateType: 'ExtractionRun',
          aggregateId: run.id,
          organizationId: params.organizationId,
          actorType: 'system',
          actorId: SYSTEM_ACTOR_ID,
          occurredAt: failedAt,
          recordedAt: failedAt,
          correlationId,
          causationId: params.causationEventId,
          payload: {
            extractionRunId: run.id,
            documentId: doc.id,
            organizationId: params.organizationId,
            ocrRunId: run.ocrRunId,
            ocrResultId: run.ocrResultId,
            providerId: provider.id,
            extractionType: run.extractionType,
            runNumber: run.runNumber,
            attemptNumber: attemptNumber + 1,
          },
          processingStatus: 'pending',
          replayable: true,
        })
      }
    })
  }
}

export type ConfirmExtractionRunParams = {
  extractionRunId: string
  organizationId: string
  confirmedByUserId: string
  correlationId?: string | null
  causationEventId?: string | null
}

/** Human confirmation — terminal success state; resolves extraction_review queue. */
export async function confirmExtractionRun(
  db: WorkersDb,
  params: ConfirmExtractionRunParams
): Promise<boolean> {
  const { extractionRuns, documents, documentExtractionResults, domainEvents } = await import(
    '@execflow/db/schema'
  )

  const [run] = await db
    .select()
    .from(extractionRuns)
    .where(
      and(
        eq(extractionRuns.id, params.extractionRunId),
        eq(extractionRuns.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (run === undefined || run.status !== 'review') return false

  const [result] = await db
    .select()
    .from(documentExtractionResults)
    .where(eq(documentExtractionResults.extractionRunId, run.id))
    .limit(1)

  if (result === undefined) return false

  assertDocumentExtractionResultRow(result, `confirmExtractionRun(${run.id})`)

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, run.documentId), eq(documents.organizationId, params.organizationId)))
    .limit(1)

  if (doc === undefined) return false

  const confirmedAt = new Date()
  const correlationId = params.correlationId ?? run.correlationId ?? randomUUID()
  const previousStatus = doc.status

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(extractionRuns)
      .set({
        status: 'confirmed',
        confirmedAt,
        confirmedByUserId: params.confirmedByUserId,
      })
      .where(and(eq(extractionRuns.id, run.id), eq(extractionRuns.status, 'review')))
      .returning({ id: extractionRuns.id })

    if (updated.length === 0) return

    await tx
      .update(documents)
      .set({
        status: 'confirmed',
        confirmedAt,
        confirmedByUserId: params.confirmedByUserId,
        updatedAt: confirmedAt,
      })
      .where(eq(documents.id, doc.id))

    await tx.insert(domainEvents).values({
      id: randomUUID(),
      eventType: EXTRACTION_CONFIRMED,
      aggregateType: 'ExtractionRun',
      aggregateId: run.id,
      organizationId: params.organizationId,
      actorType: 'user',
      actorId: params.confirmedByUserId,
      occurredAt: confirmedAt,
      recordedAt: confirmedAt,
      correlationId,
      causationId: params.causationEventId ?? null,
      payload: {
        extractionRunId: run.id,
        documentId: doc.id,
        organizationId: params.organizationId,
        confirmedByUserId: params.confirmedByUserId,
        resultId: result.id,
      },
      processingStatus: 'pending',
      replayable: true,
    })

    const docConfirmedEventId = randomUUID()
    await tx.insert(domainEvents).values({
      id: docConfirmedEventId,
      eventType: DOCUMENT_CONFIRMED,
      aggregateType: 'Document',
      aggregateId: doc.id,
      organizationId: params.organizationId,
      actorType: 'user',
      actorId: params.confirmedByUserId,
      occurredAt: confirmedAt,
      recordedAt: confirmedAt,
      correlationId,
      causationId: params.causationEventId ?? null,
      payload: buildDocumentConfirmedPayload({
        documentId: doc.id,
        organizationId: params.organizationId,
        previousStatus,
        status: 'confirmed',
      }),
      processingStatus: 'pending',
      replayable: true,
    })
  })

  await resolveQueueProjection(db, {
    organizationId: params.organizationId,
    queueType: 'extraction_review',
    entityType: 'Document',
    entityId: doc.id,
  })

  return true
}
