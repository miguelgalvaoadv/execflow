/**
 * Extraction review service — human confirm/reject with audit trail.
 */

import { eq, and } from 'drizzle-orm'
import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import {
  ok,
  validationError,
  notFoundError,
  conflictError,
  internalServiceError,
  fromRepositoryError,
} from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import {
  findExtractionRunById,
  findLatestExtractionForDocument,
} from '../repositories/extraction-run.ts'
import { insertReviewDecision, listReviewDecisionsForSubject } from '../repositories/review-decision.ts'
import { resolveQueueProjection } from '../repositories/queue-projection.ts'
import { markAutosFreshIfNewer } from '../repositories/execution-case.ts'
import {
  EXTRACTION_CONFIRMED,
  EXTRACTION_REJECTED,
  DOCUMENT_CONFIRMED,
  buildDocumentConfirmedPayload,
  assertDocumentExtractionResultRow,
} from '@execflow/db/types'
import { hasMinRole, resolveMembershipRole } from '../lib/permissions.ts'
import { TxRepositoryError } from '../lib/tx.ts'

export type ExtractionReviewView = {
  documentId: string
  extractionRunId: string
  status: string
  extractionType: string
  structuredData: Record<string, unknown>
  confidence: string
  providerMetadata: Record<string, unknown>
  extractedAt: string
  documentStatus: string
  documentClass: string | null
  executionCaseId: string | null
  reviewHistory: Array<{
    decision: string
    reason: string
    reviewerUserId: string
    reviewedAt: string
  }>
}

export async function getDocumentExtractionReview(
  ctx: WriteContext,
  documentId: string
): Promise<ServiceResult<ExtractionReviewView>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !hasMinRole(role, 'assistant')) {
    return validationError('Insufficient permissions to view extraction review.')
  }

  const loaded = await findLatestExtractionForDocument(ctx.db, ctx.organizationId, documentId)
  if (!loaded.success) return notFoundError(loaded.error.message)

  const history = await listReviewDecisionsForSubject(
    ctx.db,
    ctx.organizationId,
    'extraction',
    loaded.data.run.id
  )

  assertDocumentExtractionResultRow(loaded.data.result, `getDocumentExtractionReview(${documentId})`)

  return ok({
    documentId: loaded.data.document.id,
    extractionRunId: loaded.data.run.id,
    status: loaded.data.run.status,
    extractionType: loaded.data.run.extractionType,
    structuredData: loaded.data.result.structuredData as Record<string, unknown>,
    confidence: loaded.data.result.confidence,
    providerMetadata: loaded.data.result.providerMetadata as Record<string, unknown>,
    extractedAt: loaded.data.result.extractedAt.toISOString(),
    documentStatus: loaded.data.document.status,
    documentClass: loaded.data.document.documentClass,
    executionCaseId: loaded.data.document.executionCaseId,
    reviewHistory: history.success
      ? history.data.map((row) => ({
          decision: row.decision,
          reason: row.reason,
          reviewerUserId: row.reviewerUserId,
          reviewedAt: row.reviewedAt.toISOString(),
        }))
      : [],
  })
}

export type ConfirmExtractionInput = {
  reason?: string | undefined
}

export async function confirmExtractionReview(
  ctx: WriteContext,
  extractionRunId: string,
  input: ConfirmExtractionInput = {}
): Promise<ServiceResult<{ extractionRunId: string; documentId: string }>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !hasMinRole(role, 'assistant')) {
    return validationError('Insufficient permissions to confirm extraction.')
  }

  const runResult = await findExtractionRunById(ctx.db, ctx.organizationId, extractionRunId)
  if (!runResult.success) return notFoundError('Extraction run not found.')
  const run = runResult.data

  if (run.status !== 'review') {
    return conflictError(`Extraction run is not awaiting review (status: ${run.status}).`)
  }

  const { extractionRuns, documents, documentExtractionResults } = await import('@execflow/db/schema')

  const [result] = await ctx.db
    .select()
    .from(documentExtractionResults)
    .where(eq(documentExtractionResults.extractionRunId, run.id))
    .limit(1)

  if (result === undefined) {
    return notFoundError('Extraction result not found.')
  }

  assertDocumentExtractionResultRow(result, `confirmExtractionReview(${extractionRunId})`)

  const [doc] = await ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, run.documentId), eq(documents.organizationId, ctx.organizationId)))
    .limit(1)

  if (doc === undefined) return notFoundError('Document not found.')

  const reviewedAt = new Date()
  const reason = input.reason?.trim() || 'Extraction fields approved by reviewer.'
  const previousStatus = doc.status

  try {
    await withTx(ctx.db, async (tx) => {
      const updated = await tx
        .update(extractionRuns)
        .set({
          status: 'confirmed',
          confirmedAt: reviewedAt,
          confirmedByUserId: ctx.userId,
        })
        .where(
          and(eq(extractionRuns.id, run.id), eq(extractionRuns.status, 'review'))
        )
        .returning({ id: extractionRuns.id })

      if (updated.length === 0) {
        throw new TxRepositoryError('CONFLICT', 'Extraction run is no longer in review status.')
      }

      await tx
        .update(documents)
        .set({
          status: 'confirmed',
          confirmedAt: reviewedAt,
          confirmedByUserId: ctx.userId,
          updatedAt: reviewedAt,
        })
        .where(eq(documents.id, doc.id))

      if (doc.executionCaseId) {
        await markAutosFreshIfNewer(tx, ctx.organizationId, doc.executionCaseId, doc.uploadedAt)
      }

      unwrapOrThrow(
        await insertReviewDecision(tx, {
          organizationId: ctx.organizationId,
          subjectType: 'extraction',
          subjectId: run.id,
          documentId: doc.id,
          reviewerUserId: ctx.userId,
          reviewedAt,
          decision: 'approved',
          reason,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'confirmed',
        entityType: 'ExtractionRun',
        entityId: run.id,
        changes: {
          type: 'state_transition',
          previous: 'review',
          next: 'confirmed',
          reason,
        },
        eventType: EXTRACTION_CONFIRMED,
        aggregateType: 'ExtractionRun',
        aggregateId: run.id,
        occurredAt: reviewedAt,
        eventPayload: {
          extractionRunId: run.id,
          documentId: doc.id,
          organizationId: ctx.organizationId,
          confirmedByUserId: ctx.userId,
          resultId: result.id,
          reason,
        },
      })

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'confirmed',
        entityType: 'Document',
        entityId: doc.id,
        changes: {
          type: 'state_transition',
          previous: previousStatus,
          next: 'confirmed',
          reason,
        },
        eventType: DOCUMENT_CONFIRMED,
        aggregateType: 'Document',
        aggregateId: doc.id,
        occurredAt: reviewedAt,
        eventPayload: buildDocumentConfirmedPayload({
          documentId: doc.id,
          organizationId: ctx.organizationId,
          previousStatus,
          status: 'confirmed',
        }),
      })
    })

    await resolveQueueProjection(ctx.db, {
      organizationId: ctx.organizationId,
      queueType: 'extraction_review',
      entityType: 'Document',
      entityId: doc.id,
    })

    return ok({ extractionRunId: run.id, documentId: doc.id })
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[extraction-review.service] confirmExtractionReview failed:', err)
    return internalServiceError('Failed to confirm extraction.', err)
  }
}

export type RejectExtractionInput = {
  reason: string
}

export async function rejectExtractionReview(
  ctx: WriteContext,
  extractionRunId: string,
  input: RejectExtractionInput
): Promise<ServiceResult<{ extractionRunId: string; documentId: string }>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !hasMinRole(role, 'assistant')) {
    return validationError('Insufficient permissions to reject extraction.')
  }

  const reason = input.reason.trim()
  if (reason.length < 10) {
    return validationError('Rejection reason must be at least 10 characters.', 'reason')
  }

  const runResult = await findExtractionRunById(ctx.db, ctx.organizationId, extractionRunId)
  if (!runResult.success) return notFoundError('Extraction run not found.')
  const run = runResult.data

  if (run.status !== 'review') {
    return conflictError(`Extraction run is not awaiting review (status: ${run.status}).`)
  }

  const { extractionRuns, documents } = await import('@execflow/db/schema')

  const [doc] = await ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, run.documentId), eq(documents.organizationId, ctx.organizationId)))
    .limit(1)

  if (doc === undefined) return notFoundError('Document not found.')

  const reviewedAt = new Date()
  const previousStatus = doc.status

  try {
    await withTx(ctx.db, async (tx) => {
      await tx
        .update(extractionRuns)
        .set({ status: 'rejected', errorMessage: reason })
        .where(and(eq(extractionRuns.id, run.id), eq(extractionRuns.status, 'review')))

      await tx
        .update(documents)
        .set({ status: 'rejected', updatedAt: reviewedAt })
        .where(eq(documents.id, doc.id))

      unwrapOrThrow(
        await insertReviewDecision(tx, {
          organizationId: ctx.organizationId,
          subjectType: 'extraction',
          subjectId: run.id,
          documentId: doc.id,
          reviewerUserId: ctx.userId,
          reviewedAt,
          decision: 'rejected',
          reason,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'rejected',
        entityType: 'ExtractionRun',
        entityId: run.id,
        changes: {
          type: 'state_transition',
          previous: 'review',
          next: 'rejected',
          reason,
        },
        eventType: EXTRACTION_REJECTED,
        aggregateType: 'ExtractionRun',
        aggregateId: run.id,
        occurredAt: reviewedAt,
        eventPayload: {
          extractionRunId: run.id,
          documentId: doc.id,
          organizationId: ctx.organizationId,
          rejectedByUserId: ctx.userId,
          previousDocumentStatus: previousStatus,
          reason,
        },
      })
    })

    await resolveQueueProjection(ctx.db, {
      organizationId: ctx.organizationId,
      queueType: 'extraction_review',
      entityType: 'Document',
      entityId: doc.id,
    })

    return ok({ extractionRunId: run.id, documentId: doc.id })
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[extraction-review.service] rejectExtractionReview failed:', err)
    return internalServiceError('Failed to reject extraction.', err)
  }
}
