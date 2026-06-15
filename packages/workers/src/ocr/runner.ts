/**
 * OCR pipeline runner — executes OCR for a single run with lifecycle + outbox events.
 */

import { randomUUID } from 'node:crypto'
import { eq, and, sql, max } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'
import type { OcrProvider } from '@execflow/ocr'
import { OcrProviderError } from '@execflow/ocr'
import {
  OCR_REQUESTED,
  OCR_RUNNING,
  OCR_COMPLETED,
  OCR_FAILED,
} from '@execflow/db/types'

const SYSTEM_ACTOR_ID = 'ocr.worker'

export type ScheduleOcrForDocumentParams = {
  organizationId: string
  documentId: string
  triggerEventId: string
  correlationId: string
  providerId: string
  maxAttempts: number
}

/** Creates ocr_run + ocr.requested outbox event (idempotent on triggerEventId). */
export async function scheduleOcrForDocument(
  db: WorkersDb,
  params: ScheduleOcrForDocumentParams
): Promise<string | null> {
  const { ocrRuns, domainEvents } = await import('@execflow/db/schema')
  const now = new Date()

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: ocrRuns.id })
      .from(ocrRuns)
      .where(
        and(
          eq(ocrRuns.documentId, params.documentId),
          eq(ocrRuns.triggerEventId, params.triggerEventId)
        )
      )
      .limit(1)

    if (existing[0] !== undefined) {
      return existing[0].id
    }

    const [maxRow] = await tx
      .select({ value: max(ocrRuns.runNumber) })
      .from(ocrRuns)
      .where(eq(ocrRuns.documentId, params.documentId))

    const runNumber = (maxRow?.value ?? 0) + 1
    const ocrRunId = randomUUID()
    const eventId = randomUUID()

    await tx.insert(ocrRuns).values({
      id: ocrRunId,
      organizationId: params.organizationId,
      documentId: params.documentId,
      runNumber,
      status: 'requested',
      providerId: params.providerId,
      attemptCount: 0,
      maxAttempts: params.maxAttempts,
      triggerEventId: params.triggerEventId,
      correlationId: params.correlationId,
    })

    await tx.insert(domainEvents).values({
      id: eventId,
      eventType: OCR_REQUESTED,
      aggregateType: 'OcrRun',
      aggregateId: ocrRunId,
      organizationId: params.organizationId,
      actorType: 'system',
      actorId: SYSTEM_ACTOR_ID,
      occurredAt: now,
      recordedAt: now,
      correlationId: params.correlationId,
      causationId: params.triggerEventId,
      payload: {
        ocrRunId,
        documentId: params.documentId,
        organizationId: params.organizationId,
        providerId: params.providerId,
        runNumber,
        attemptNumber: 1,
      },
      processingStatus: 'pending',
      replayable: true,
    })

    return ocrRunId
  })
}

export type ExecuteOcrRunParams = {
  ocrRunId: string
  organizationId: string
  correlationId: string | null
  causationEventId: string | null
}

/** Runs OCR for an existing ocr_run; updates lifecycle and persists append-only result. */
export async function executeOcrRun(
  db: WorkersDb,
  provider: OcrProvider,
  params: ExecuteOcrRunParams
): Promise<void> {
  const { ocrRuns, documents, documentOcrResults, domainEvents } = await import(
    '@execflow/db/schema'
  )

  const [run] = await db
    .select()
    .from(ocrRuns)
    .where(
      and(eq(ocrRuns.id, params.ocrRunId), eq(ocrRuns.organizationId, params.organizationId))
    )
    .limit(1)

  if (run === undefined) return
  if (run.status === 'completed') return
  if (run.status === 'failed' && run.attemptCount >= run.maxAttempts) return

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, run.documentId), eq(documents.organizationId, params.organizationId)))
    .limit(1)

  if (doc === undefined) return

  const attemptNumber = run.attemptCount + 1
  const now = new Date()
  const correlationId = params.correlationId ?? run.correlationId ?? randomUUID()

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(ocrRuns)
      .set({
        status: 'running',
        attemptCount: attemptNumber,
        startedAt: now,
        errorMessage: null,
      })
      .where(
        and(
          eq(ocrRuns.id, run.id),
          sql`${ocrRuns.status} IN ('requested', 'failed')`
        )
      )
      .returning({ id: ocrRuns.id })

    if (updated.length === 0) return

    await tx
      .update(documents)
      .set({ ocrStatus: 'running', updatedAt: now })
      .where(and(eq(documents.id, doc.id), eq(documents.organizationId, params.organizationId)))

    await tx.insert(domainEvents).values({
      id: randomUUID(),
      eventType: OCR_RUNNING,
      aggregateType: 'OcrRun',
      aggregateId: run.id,
      organizationId: params.organizationId,
      actorType: 'system',
      actorId: SYSTEM_ACTOR_ID,
      occurredAt: now,
      recordedAt: now,
      correlationId,
      causationId: params.causationEventId,
      payload: {
        ocrRunId: run.id,
        documentId: doc.id,
        organizationId: params.organizationId,
        attemptNumber,
      },
      processingStatus: 'pending',
      replayable: true,
    })
  })

  try {
    const extracted = await provider.extractText({
      documentId: doc.id,
      organizationId: doc.organizationId,
      storageKey: doc.storageKey,
      mimeType: doc.mimeType,
      fileName: doc.fileName,
      byteSize: Number(doc.byteSize),
    })

    const extractedAt = new Date()
    const resultId = randomUUID()

    await db.transaction(async (tx) => {
      await tx.insert(documentOcrResults).values({
        id: resultId,
        organizationId: params.organizationId,
        documentId: doc.id,
        ocrRunId: run.id,
        providerId: provider.id,
        rawText: extracted.rawText,
        pageCount: extracted.pageCount,
        providerMetadata: extracted.providerMetadata,
        extractedAt,
      })

      await tx
        .update(ocrRuns)
        .set({ status: 'completed', completedAt: extractedAt, errorMessage: null })
        .where(eq(ocrRuns.id, run.id))

      await tx
        .update(documents)
        .set({ ocrStatus: 'completed', updatedAt: extractedAt })
        .where(eq(documents.id, doc.id))

      await tx.insert(domainEvents).values({
        id: randomUUID(),
        eventType: OCR_COMPLETED,
        aggregateType: 'OcrRun',
        aggregateId: run.id,
        organizationId: params.organizationId,
        actorType: 'system',
        actorId: SYSTEM_ACTOR_ID,
        occurredAt: extractedAt,
        recordedAt: extractedAt,
        correlationId,
        causationId: params.causationEventId,
        payload: {
          ocrRunId: run.id,
          documentId: doc.id,
          organizationId: params.organizationId,
          providerId: provider.id,
          pageCount: extracted.pageCount,
          resultId,
        },
        processingStatus: 'pending',
        replayable: true,
      })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const retryable = err instanceof OcrProviderError ? err.retryable : true
    const failedAt = new Date()

    await db.transaction(async (tx) => {
      const finalFailure = attemptNumber >= run.maxAttempts || !retryable

      await tx
        .update(ocrRuns)
        .set({
          status: finalFailure ? 'failed' : 'requested',
          completedAt: finalFailure ? failedAt : null,
          errorMessage: message,
        })
        .where(eq(ocrRuns.id, run.id))

      await tx
        .update(documents)
        .set({
          ocrStatus: finalFailure ? 'failed' : 'pending',
          updatedAt: failedAt,
        })
        .where(eq(documents.id, doc.id))

      await tx.insert(domainEvents).values({
        id: randomUUID(),
        eventType: OCR_FAILED,
        aggregateType: 'OcrRun',
        aggregateId: run.id,
        organizationId: params.organizationId,
        actorType: 'system',
        actorId: SYSTEM_ACTOR_ID,
        occurredAt: failedAt,
        recordedAt: failedAt,
        correlationId,
        causationId: params.causationEventId,
        payload: {
          ocrRunId: run.id,
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
          eventType: OCR_REQUESTED,
          aggregateType: 'OcrRun',
          aggregateId: run.id,
          organizationId: params.organizationId,
          actorType: 'system',
          actorId: SYSTEM_ACTOR_ID,
          occurredAt: failedAt,
          recordedAt: failedAt,
          correlationId,
          causationId: params.causationEventId,
          payload: {
            ocrRunId: run.id,
            documentId: doc.id,
            organizationId: params.organizationId,
            providerId: provider.id,
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
