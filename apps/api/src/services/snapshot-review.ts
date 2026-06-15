/**
 * Snapshot review service — unified GET/confirm/reject for sentence and custody snapshots.
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
import { findSentenceSnapshotById } from '../repositories/sentence-snapshot.ts'
import { findCustodySnapshotById } from '../repositories/custody-snapshot.ts'
import { confirmSentenceSnapshotRow } from '../repositories/sentence-snapshot.ts'
import { confirmCustodySnapshotRow } from '../repositories/custody-snapshot.ts'
import { insertReviewDecision, listReviewDecisionsForSubject } from '../repositories/review-decision.ts'
import { resolveQueueProjection } from '../repositories/queue-projection.ts'
import { SNAPSHOT_CONFIRMED, SNAPSHOT_REJECTED } from '@execflow/db/types'
import { hasMinRole, resolveMembershipRole } from '../lib/permissions.ts'
import { TxRepositoryError } from '../lib/tx.ts'

export type SnapshotReviewView = {
  snapshotId: string
  snapshotKind: 'sentence' | 'custody'
  status: string
  executionCaseId: string
  effectiveAt: string
  payload: Record<string, unknown>
  reviewHistory: Array<{
    decision: string
    reason: string
    reviewerUserId: string
    reviewedAt: string
  }>
}

export async function getSnapshotReview(
  ctx: WriteContext,
  snapshotId: string
): Promise<ServiceResult<SnapshotReviewView>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !hasMinRole(role, 'assistant')) {
    return validationError('Insufficient permissions to view snapshot review.')
  }

  const sentence = await findSentenceSnapshotById(ctx.db, ctx.organizationId, snapshotId)
  if (sentence.success) {
    const history = await listReviewDecisionsForSubject(
      ctx.db,
      ctx.organizationId,
      'snapshot',
      snapshotId
    )
    return ok({
      snapshotId: sentence.data.id,
      snapshotKind: 'sentence',
      status: sentence.data.status,
      executionCaseId: sentence.data.executionCaseId,
      effectiveAt: sentence.data.effectiveAt.toISOString(),
      payload: {
        totalSentenceDays: sentence.data.totalSentenceDays,
        servedDays: sentence.data.servedDays,
        remissionDays: sentence.data.remissionDays,
        detractionDays: sentence.data.detractionDays,
        remainingDays: sentence.data.remainingDays,
        percentServed: sentence.data.percentServed,
        confidenceLevel: sentence.data.confidenceLevel,
        sourceDocumentIds: sentence.data.sourceDocumentIds,
        explanation: sentence.data.explanation,
      },
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

  const custody = await findCustodySnapshotById(ctx.db, ctx.organizationId, snapshotId)
  if (custody.success) {
    const history = await listReviewDecisionsForSubject(
      ctx.db,
      ctx.organizationId,
      'snapshot',
      snapshotId
    )
    const status =
      custody.data.rejectedAt !== null
        ? 'rejected'
        : custody.data.confirmedByUserId !== null
          ? 'confirmed'
          : 'proposed'

    return ok({
      snapshotId: custody.data.id,
      snapshotKind: 'custody',
      status,
      executionCaseId: custody.data.executionCaseId,
      effectiveAt: custody.data.effectiveAt.toISOString(),
      payload: {
        regime: custody.data.regime,
        confidence: custody.data.confidence,
        notes: custody.data.notes,
        prisonUnitId: custody.data.prisonUnitId,
      },
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

  return notFoundError('Snapshot not found.')
}

export type ConfirmSnapshotInput = {
  reason?: string | undefined
}

export async function confirmSnapshotReview(
  ctx: WriteContext,
  snapshotId: string,
  input: ConfirmSnapshotInput = {}
): Promise<ServiceResult<{ snapshotId: string; snapshotKind: 'sentence' | 'custody' }>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !hasMinRole(role, 'lawyer')) {
    return validationError('Lawyer role required to confirm snapshots.')
  }

  const view = await getSnapshotReview(ctx, snapshotId)
  if (!view.success) return view

  if (view.data.status !== 'proposed') {
    return conflictError(`Snapshot is not awaiting review (status: ${view.data.status}).`)
  }

  const reviewedAt = new Date()
  const reason = input.reason?.trim() || 'Snapshot approved by reviewer.'

  try {
    if (view.data.snapshotKind === 'sentence') {
      await withTx(ctx.db, async (tx) => {
        unwrapOrThrow(
          await confirmSentenceSnapshotRow(tx, ctx.organizationId, snapshotId, {
            confirmedByUserId: ctx.userId,
            confirmedAt: reviewedAt,
          })
        )

        unwrapOrThrow(
          await insertReviewDecision(tx, {
            organizationId: ctx.organizationId,
            subjectType: 'snapshot',
            subjectId: snapshotId,
            snapshotKind: 'sentence',
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
          entityType: 'SentenceSnapshot',
          entityId: snapshotId,
          changes: {
            type: 'state_transition',
            previous: 'proposed',
            next: 'confirmed',
            reason,
          },
          eventType: SNAPSHOT_CONFIRMED,
          aggregateType: 'SentenceSnapshot',
          aggregateId: snapshotId,
          occurredAt: reviewedAt,
          eventPayload: {
            snapshotId,
            snapshotKind: 'sentence',
            executionCaseId: view.data.executionCaseId,
            organizationId: ctx.organizationId,
            confirmedByUserId: ctx.userId,
            status: 'confirmed',
            reason,
          },
        })
      })
    } else {
      const { custodySnapshots } = await import('@execflow/db/schema')

      await withTx(ctx.db, async (tx) => {
        unwrapOrThrow(
          await confirmCustodySnapshotRow(tx, ctx.organizationId, snapshotId, {
            confirmedByUserId: ctx.userId,
            confirmedAt: reviewedAt,
          })
        )

        const [row] = await tx
          .select()
          .from(custodySnapshots)
          .where(eq(custodySnapshots.id, snapshotId))
          .limit(1)

        unwrapOrThrow(
          await insertReviewDecision(tx, {
            organizationId: ctx.organizationId,
            subjectType: 'snapshot',
            subjectId: snapshotId,
            snapshotKind: 'custody',
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
          entityType: 'CustodySnapshot',
          entityId: snapshotId,
          changes: {
            type: 'state_transition',
            previous: 'proposed',
            next: 'confirmed',
            reason,
          },
          eventType: SNAPSHOT_CONFIRMED,
          aggregateType: 'CustodySnapshot',
          aggregateId: snapshotId,
          occurredAt: reviewedAt,
          eventPayload: {
            snapshotId,
            snapshotKind: 'custody',
            executionCaseId: view.data.executionCaseId,
            organizationId: ctx.organizationId,
            confirmedByUserId: ctx.userId,
            status: 'confirmed',
            reason,
          },
        })

        await writeAuditAndEvent({
          tx,
          actor: ctx.actor,
          organizationId: ctx.organizationId,
          requestId: ctx.requestId,
          correlationId: ctx.correlationId,
          action: 'created',
          entityType: 'CustodySnapshot',
          entityId: snapshotId,
          changes: {
            type: 'state_transition',
            previous: 'proposed',
            next: 'confirmed',
          },
          eventType: 'custody.snapshot.created',
          aggregateType: 'CustodySnapshot',
          aggregateId: snapshotId,
          occurredAt: row?.effectiveAt ?? reviewedAt,
          eventPayload: {
            snapshotId,
            custodySnapshotId: snapshotId,
            executionCaseId: view.data.executionCaseId,
            organizationId: ctx.organizationId,
            regime: row?.regime ?? 'unknown',
          },
        })
      })
    }

    await resolveQueueProjection(ctx.db, {
      organizationId: ctx.organizationId,
      queueType: 'snapshot_review',
      entityType: view.data.snapshotKind === 'sentence' ? 'SentenceSnapshot' : 'CustodySnapshot',
      entityId: snapshotId,
    })

    return ok({ snapshotId, snapshotKind: view.data.snapshotKind })
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[snapshot-review.service] confirmSnapshotReview failed:', err)
    return internalServiceError('Failed to confirm snapshot.', err)
  }
}

export type RejectSnapshotInput = {
  reason: string
}

export async function rejectSnapshotReview(
  ctx: WriteContext,
  snapshotId: string,
  input: RejectSnapshotInput
): Promise<ServiceResult<{ snapshotId: string; snapshotKind: 'sentence' | 'custody' }>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !hasMinRole(role, 'lawyer')) {
    return validationError('Lawyer role required to reject snapshots.')
  }

  const reason = input.reason.trim()
  if (reason.length < 10) {
    return validationError('Rejection reason must be at least 10 characters.', 'reason')
  }

  const view = await getSnapshotReview(ctx, snapshotId)
  if (!view.success) return view

  if (view.data.status !== 'proposed') {
    return conflictError(`Snapshot is not awaiting review (status: ${view.data.status}).`)
  }

  const reviewedAt = new Date()
  const { sentenceSnapshots, custodySnapshots } = await import('@execflow/db/schema')

  try {
    if (view.data.snapshotKind === 'sentence') {
      await withTx(ctx.db, async (tx) => {
        const updated = await tx
          .update(sentenceSnapshots)
          .set({ status: 'rejected' })
          .where(
            and(
              eq(sentenceSnapshots.id, snapshotId),
              eq(sentenceSnapshots.organizationId, ctx.organizationId),
              eq(sentenceSnapshots.status, 'proposed')
            )
          )
          .returning({ id: sentenceSnapshots.id })

        if (updated.length === 0) {
          throw new TxRepositoryError('CONFLICT', 'Snapshot is no longer in proposed status.')
        }

        unwrapOrThrow(
          await insertReviewDecision(tx, {
            organizationId: ctx.organizationId,
            subjectType: 'snapshot',
            subjectId: snapshotId,
            snapshotKind: 'sentence',
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
          entityType: 'SentenceSnapshot',
          entityId: snapshotId,
          changes: {
            type: 'state_transition',
            previous: 'proposed',
            next: 'rejected',
            reason,
          },
          eventType: SNAPSHOT_REJECTED,
          aggregateType: 'SentenceSnapshot',
          aggregateId: snapshotId,
          occurredAt: reviewedAt,
          eventPayload: {
            snapshotId,
            snapshotKind: 'sentence',
            executionCaseId: view.data.executionCaseId,
            organizationId: ctx.organizationId,
            rejectedByUserId: ctx.userId,
            reason,
          },
        })
      })
    } else {
      await withTx(ctx.db, async (tx) => {
        const updated = await tx
          .update(custodySnapshots)
          .set({
            rejectedAt: reviewedAt,
            rejectedByUserId: ctx.userId,
          })
          .where(
            and(
              eq(custodySnapshots.id, snapshotId),
              eq(custodySnapshots.organizationId, ctx.organizationId)
            )
          )
          .returning({ id: custodySnapshots.id })

        if (updated.length === 0) {
          throw new TxRepositoryError('NOT_FOUND', 'Custody snapshot not found.')
        }

        unwrapOrThrow(
          await insertReviewDecision(tx, {
            organizationId: ctx.organizationId,
            subjectType: 'snapshot',
            subjectId: snapshotId,
            snapshotKind: 'custody',
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
          entityType: 'CustodySnapshot',
          entityId: snapshotId,
          changes: {
            type: 'state_transition',
            previous: 'proposed',
            next: 'rejected',
            reason,
          },
          eventType: SNAPSHOT_REJECTED,
          aggregateType: 'CustodySnapshot',
          aggregateId: snapshotId,
          occurredAt: reviewedAt,
          eventPayload: {
            snapshotId,
            snapshotKind: 'custody',
            executionCaseId: view.data.executionCaseId,
            organizationId: ctx.organizationId,
            rejectedByUserId: ctx.userId,
            reason,
          },
        })
      })
    }

    await resolveQueueProjection(ctx.db, {
      organizationId: ctx.organizationId,
      queueType: 'snapshot_review',
      entityType: view.data.snapshotKind === 'sentence' ? 'SentenceSnapshot' : 'CustodySnapshot',
      entityId: snapshotId,
    })

    return ok({ snapshotId, snapshotKind: view.data.snapshotKind })
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[snapshot-review.service] rejectSnapshotReview failed:', err)
    return internalServiceError('Failed to reject snapshot.', err)
  }
}
