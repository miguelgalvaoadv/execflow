/**
 * SentenceSnapshot service — propose → confirm → supersede lifecycle.
 *
 * APPEND-ONLY: arithmetic is set at INSERT; confirm/supersede only mutate review status.
 * Human-authority-first: confirm and supersede require lawyer attribution.
 */

import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { findCaseById } from '../repositories/execution-case.ts'
import {
  findSentenceSnapshotById,
  insertSentenceSnapshot,
  confirmSentenceSnapshotRow,
  markSentenceSnapshotSuperseded,
} from '../repositories/sentence-snapshot.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import {
  computePercentServed,
  computeRemainingDays,
  validateSentenceArithmetic,
} from '../lib/snapshot-arithmetic.ts'
import {
  ok,
  validationError,
  notFoundError,
  internalServiceError,
  fromRepositoryError,
} from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import type { SentenceSnapshot } from '@execflow/db/schema'
import type { ConfidenceLevel } from '@execflow/db/types'
import { TxRepositoryError } from '../lib/tx.ts'

export type ProposeSentenceSnapshotInput = {
  effectiveAt: string
  totalSentenceDays: number
  servedDays?: number | undefined
  remissionDays?: number | undefined
  detractionDays?: number | undefined
  confidenceLevel?: ConfidenceLevel | undefined
  calculationMethod?: string | undefined
  playbookVersionId?: string | undefined
  sourceDocumentIds?: string[] | undefined
  explanation?: Record<string, unknown> | undefined
  missingDataFlags?: Array<{ field: string; impact: 'high' | 'medium'; description: string }> | undefined
  amendsSnapshotId?: string | undefined
}

export type SupersedeSentenceSnapshotInput = ProposeSentenceSnapshotInput & {
  reason: string
}

function parseEffectiveAt(value: string): Date | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function buildArithmetic(input: ProposeSentenceSnapshotInput) {
  const arithmetic = {
    totalSentenceDays: input.totalSentenceDays,
    servedDays: input.servedDays ?? 0,
    remissionDays: input.remissionDays ?? 0,
    detractionDays: input.detractionDays ?? 0,
  }
  const err = validateSentenceArithmetic(arithmetic)
  if (err !== null) return { error: err as string }
  return {
    arithmetic,
    remainingDays: computeRemainingDays(arithmetic),
    percentServed: computePercentServed(arithmetic),
  }
}

export async function proposeSentenceSnapshot(
  ctx: WriteContext,
  executionCaseId: string,
  input: ProposeSentenceSnapshotInput
): Promise<ServiceResult<SentenceSnapshot>> {
  const effectiveAt = parseEffectiveAt(input.effectiveAt)
  if (effectiveAt === null) {
    return validationError('effectiveAt must be a valid ISO 8601 datetime.', 'effectiveAt')
  }

  const built = buildArithmetic(input)
  if ('error' in built) {
    return validationError(built.error)
  }

  const caseResult = await findCaseById(ctx.db, ctx.organizationId, executionCaseId)
  if (!caseResult.success) {
    return notFoundError('Execution case not found.')
  }

  if (input.amendsSnapshotId !== undefined) {
    const amendResult = await findSentenceSnapshotById(
      ctx.db,
      ctx.organizationId,
      input.amendsSnapshotId
    )
    if (!amendResult.success) {
      return notFoundError('amendsSnapshotId does not refer to an existing snapshot in this org.')
    }
  }

  try {
    const snapshot = await withTx(ctx.db, async (tx) => {
      const row = unwrapOrThrow(
        await insertSentenceSnapshot(tx, {
          organizationId: ctx.organizationId,
          executionCaseId,
          effectiveAt,
          status: 'proposed',
          totalSentenceDays: built.arithmetic.totalSentenceDays,
          servedDays: built.arithmetic.servedDays,
          remissionDays: built.arithmetic.remissionDays,
          detractionDays: built.arithmetic.detractionDays,
          remainingDays: built.remainingDays,
          percentServed: built.percentServed,
          confidenceLevel: input.confidenceLevel ?? 'unknown',
          calculationMethod: input.calculationMethod,
          playbookVersionId: input.playbookVersionId,
          sourceDocumentIds: input.sourceDocumentIds ?? [],
          explanation: input.explanation ?? null,
          missingDataFlags: input.missingDataFlags ?? [],
          amendsSnapshotId: input.amendsSnapshotId,
          createdByUserId: ctx.userId,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'SentenceSnapshot',
        entityId: row.id,
        changes: {
          type: 'creation',
          snapshot: { status: 'proposed', executionCaseId },
        },
        eventType: 'sentence.snapshot.proposed',
        aggregateType: 'SentenceSnapshot',
        aggregateId: row.id,
        occurredAt: effectiveAt,
        eventPayload: {
          snapshotId: row.id,
          executionCaseId,
          organizationId: ctx.organizationId,
          status: 'proposed',
          effectiveAt: effectiveAt.toISOString(),
          totalSentenceDays: built.arithmetic.totalSentenceDays,
          confidenceLevel: input.confidenceLevel ?? 'unknown',
        },
      })

      return row
    })

    return ok(snapshot)
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[sentence-snapshot.service] proposeSentenceSnapshot failed:', err)
    return internalServiceError('Failed to propose sentence snapshot.', err)
  }
}

export async function confirmSentenceSnapshot(
  ctx: WriteContext,
  snapshotId: string
): Promise<ServiceResult<SentenceSnapshot>> {
  const existing = await findSentenceSnapshotById(ctx.db, ctx.organizationId, snapshotId)
  if (!existing.success) {
    return notFoundError('Sentence snapshot not found.')
  }
  if (existing.data.status !== 'proposed') {
    return validationError(
      `Only proposed snapshots can be confirmed (current: ${existing.data.status}).`,
      'status'
    )
  }

  const confirmedAt = new Date()

  try {
    const snapshot = await withTx(ctx.db, async (tx) => {
      const row = unwrapOrThrow(
        await confirmSentenceSnapshotRow(tx, ctx.organizationId, snapshotId, {
          confirmedByUserId: ctx.userId,
          confirmedAt,
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
        entityId: row.id,
        changes: {
          type: 'state_transition',
          previous: 'proposed',
          next: 'confirmed',
        },
        eventType: 'snapshot.confirmed',
        aggregateType: 'SentenceSnapshot',
        aggregateId: row.id,
        occurredAt: confirmedAt,
        eventPayload: {
          snapshotId: row.id,
          snapshotKind: 'sentence',
          executionCaseId: row.executionCaseId,
          organizationId: ctx.organizationId,
          effectiveAt: row.effectiveAt.toISOString(),
          confirmedByUserId: ctx.userId,
          status: 'confirmed',
        },
      })

      return row
    })

    return ok(snapshot)
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[sentence-snapshot.service] confirmSentenceSnapshot failed:', err)
    return internalServiceError('Failed to confirm sentence snapshot.', err)
  }
}

export async function supersedeSentenceSnapshot(
  ctx: WriteContext,
  snapshotId: string,
  input: SupersedeSentenceSnapshotInput
): Promise<ServiceResult<{ superseded: SentenceSnapshot; replacement: SentenceSnapshot }>> {
  const existing = await findSentenceSnapshotById(ctx.db, ctx.organizationId, snapshotId)
  if (!existing.success) {
    return notFoundError('Sentence snapshot not found.')
  }
  if (existing.data.status !== 'confirmed') {
    return validationError(
      `Only confirmed snapshots can be superseded (current: ${existing.data.status}).`,
      'status'
    )
  }

  if (!input.reason.trim()) {
    return validationError('reason is required for supersede.', 'reason')
  }

  const effectiveAt = parseEffectiveAt(input.effectiveAt)
  if (effectiveAt === null) {
    return validationError('effectiveAt must be a valid ISO 8601 datetime.', 'effectiveAt')
  }

  const built = buildArithmetic(input)
  if ('error' in built) {
    return validationError(built.error)
  }

  const executionCaseId = existing.data.executionCaseId
  const supersededAt = new Date()

  try {
    const result = await withTx(ctx.db, async (tx) => {
      const superseded = unwrapOrThrow(
        await markSentenceSnapshotSuperseded(tx, ctx.organizationId, snapshotId)
      )

      const replacement = unwrapOrThrow(
        await insertSentenceSnapshot(tx, {
          organizationId: ctx.organizationId,
          executionCaseId,
          effectiveAt,
          status: 'proposed',
          totalSentenceDays: built.arithmetic.totalSentenceDays,
          servedDays: built.arithmetic.servedDays,
          remissionDays: built.arithmetic.remissionDays,
          detractionDays: built.arithmetic.detractionDays,
          remainingDays: built.remainingDays,
          percentServed: built.percentServed,
          confidenceLevel: input.confidenceLevel ?? superseded.confidenceLevel,
          calculationMethod: input.calculationMethod ?? superseded.calculationMethod,
          playbookVersionId: input.playbookVersionId ?? superseded.playbookVersionId,
          sourceDocumentIds: input.sourceDocumentIds ?? superseded.sourceDocumentIds,
          explanation: input.explanation ?? superseded.explanation,
          missingDataFlags: input.missingDataFlags ?? superseded.missingDataFlags,
          amendsSnapshotId: snapshotId,
          createdByUserId: ctx.userId,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'status_changed',
        entityType: 'SentenceSnapshot',
        entityId: superseded.id,
        changes: {
          type: 'state_transition',
          previous: 'confirmed',
          next: 'superseded',
        },
        eventType: 'sentence.snapshot.superseded',
        aggregateType: 'SentenceSnapshot',
        aggregateId: superseded.id,
        occurredAt: supersededAt,
        eventPayload: {
          snapshotId: superseded.id,
          supersededSnapshotId: superseded.id,
          replacementSnapshotId: replacement.id,
          executionCaseId,
          organizationId: ctx.organizationId,
          reason: input.reason.trim(),
          effectiveAt: superseded.effectiveAt.toISOString(),
        },
      })

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'SentenceSnapshot',
        entityId: replacement.id,
        changes: {
          type: 'creation',
          snapshot: { status: 'proposed', amendsSnapshotId: snapshotId },
        },
        eventType: 'sentence.snapshot.proposed',
        aggregateType: 'SentenceSnapshot',
        aggregateId: replacement.id,
        occurredAt: effectiveAt,
        eventPayload: {
          snapshotId: replacement.id,
          executionCaseId,
          organizationId: ctx.organizationId,
          status: 'proposed',
          amendsSnapshotId: snapshotId,
          effectiveAt: effectiveAt.toISOString(),
        },
      })

      return { superseded, replacement }
    })

    return ok(result)
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[sentence-snapshot.service] supersedeSentenceSnapshot failed:', err)
    return internalServiceError('Failed to supersede sentence snapshot.', err)
  }
}
