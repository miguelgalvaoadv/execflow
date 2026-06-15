/**
 * Deadline service — domain operations for the Deadline entity.
 *
 * STATE MACHINE ENFORCEMENT:
 * This service is the authoritative enforcement point for deadline transitions.
 * No code outside this service may change deadline.status directly.
 *
 * TERMINAL STATE PROTECTION:
 * completed and dismissed are terminal — no further transitions allowed.
 * Enforced explicitly at the start of every transition method.
 *
 * HISTORY TRAIL:
 * Every status transition appends a DeadlineHistory row in the same transaction.
 * Due date changes also append a history row with previous/new due_at.
 *
 * IMMUTABILITY GUARDS:
 * origin, execution_case_id, organization_id, created_at are never touched
 * by any operation in this service.
 *
 * Architecture ref: execution-workflows.md §4, data-model-v1.md §2.8.
 */

import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { findCaseById } from '../repositories/execution-case.ts'
import { insertDeadline, findDeadlineById, updateDeadlineStatus } from '../repositories/deadline.ts'
import { appendDeadlineHistory } from '../repositories/deadline-history.ts'
import { appendTimelineEvent } from '../repositories/timeline-event.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import { deadlineHistoryUserActor } from '@execflow/db/types'
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
import type { Deadline } from '@execflow/db/schema'
import type {
  DeadlineClass,
  DeadlineOrigin,
  DeadlinePriority,
} from '@execflow/db/types'

// ---------------------------------------------------------------------------
// Terminal state check helper
// ---------------------------------------------------------------------------

const TERMINAL_DEADLINE_STATES = new Set(['completed', 'dismissed'])

function isTerminalDeadlineState(status: string): boolean {
  return TERMINAL_DEADLINE_STATES.has(status)
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateDeadlineInput = {
  executionCaseId: string
  title: string
  description?: string | undefined
  dueAt: string        // ISO 8601 — LEGAL due date
  deadlineClass: DeadlineClass
  origin: DeadlineOrigin
  priority?: DeadlinePriority | undefined
  assigneeUserId?: string | undefined
  sourceEventId?: string | undefined
  sourceDocumentId?: string | undefined
  playbookVersionId?: string | undefined
  legalBasis?: string | undefined
  parentDeadlineId?: string | undefined
  recurrencePattern?: Record<string, unknown> | undefined
}

export type CompleteDeadlineInput = {
  completionEvidenceType?: string | undefined
  completionEvidenceId?: string | undefined
  reason?: string | undefined
}

export type DismissDeadlineInput = {
  dismissedReason: string
  dismissedReasonCode?: string | undefined
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

/**
 * Create a new deadline.
 *
 * Validation:
 * - executionCaseId must exist and belong to this org
 * - dueAt must be a valid date
 * - title is required
 *
 * Writes atomically: Deadline + opening TimelineEvent + AuditLog + DomainEvent.
 */
export async function createDeadline(
  ctx: WriteContext,
  input: CreateDeadlineInput
): Promise<ServiceResult<Deadline>> {
  if (!input.title.trim()) {
    return validationError('Deadline title is required.', 'title')
  }
  if (!input.dueAt) {
    return validationError('Due date (dueAt) is required.', 'dueAt')
  }

  const dueAt = new Date(input.dueAt)
  if (isNaN(dueAt.getTime())) {
    return validationError('dueAt must be a valid ISO 8601 datetime.', 'dueAt')
  }

  // Verify case exists in this org
  const caseResult = await findCaseById(ctx.db, ctx.organizationId, input.executionCaseId)
  if (!caseResult.success) {
    return notFoundError('Execution case not found in this organization.')
  }

  try {
    const deadline = await withTx(ctx.db, async (tx) => {
      const now = new Date()

      const deadlineResult = unwrapOrThrow(
        await insertDeadline(tx, {
          organizationId: ctx.organizationId,
          executionCaseId: input.executionCaseId,
          title: input.title.trim(),
          description: input.description?.trim(),
          dueAt,
          deadlineClass: input.deadlineClass,
          origin: input.origin,
          priority: input.priority ?? 'normal',
          status: 'open',
          assigneeUserId: input.assigneeUserId,
          sourceEventId: input.sourceEventId,
          sourceDocumentId: input.sourceDocumentId,
          playbookVersionId: input.playbookVersionId,
          legalBasis: input.legalBasis?.trim(),
          parentDeadlineId: input.parentDeadlineId,
          recurrencePattern: input.recurrencePattern,
          escalationLevel: 0,
          isBlocked: false,
          isStale: false,
          createdAt: now,
          createdByUserId: ctx.userId,
          updatedAt: now,
        })
      )

      // Append timeline event for the deadline creation
      unwrapOrThrow(await appendTimelineEvent(tx, {
        organizationId: ctx.organizationId,
        executionCaseId: input.executionCaseId,
        eventType: 'deadline.created',
        eventCategory: 'internal',
        occurredAt: now,
        summary: `Deadline created: "${input.title.trim()}" — due ${dueAt.toISOString().slice(0, 10)}.`,
        payload: {
          deadlineId: deadlineResult.id,
          deadlineClass: input.deadlineClass,
          priority: input.priority ?? 'normal',
          dueAt: dueAt.toISOString(),
          origin: input.origin,
        },
        source: input.origin === 'manual' ? 'manual' : 'system_rule',
        actorType: 'user',
        actorId: ctx.actor.actorId,
        authorUserId: ctx.userId,
        visibility: 'internal',
        sourceRefType: 'Deadline',
        sourceRefId: deadlineResult.id,
      }))

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'Deadline',
        entityId: deadlineResult.id,
        changes: {
          type: 'creation',
          snapshot: {
            status: 'open',
            deadlineClass: input.deadlineClass,
            origin: input.origin,
            priority: input.priority ?? 'normal',
            dueAt: dueAt.toISOString(),
          },
        },
        eventType: 'deadline.created',
        aggregateType: 'Deadline',
        aggregateId: deadlineResult.id,
        occurredAt: now,
        eventPayload: {
          deadlineId: deadlineResult.id,
          executionCaseId: input.executionCaseId,
          organizationId: ctx.organizationId,
          deadlineClass: input.deadlineClass,
          origin: input.origin,
          priority: input.priority ?? 'normal',
          dueAt: dueAt.toISOString(),
          createdByUserId: ctx.userId,
        },
      })

      return deadlineResult
    })

    return ok(deadline)
  } catch (err) {
    console.error('[deadline.service] createDeadline failed:', err)
    return internalServiceError('Failed to create deadline.', err)
  }
}

/**
 * Acknowledge a deadline.
 * Transition: open → acknowledged
 * Meaning: "I have seen this deadline and I am working on it."
 *
 * Valid from: open, overdue (retroactive acknowledgement also allowed)
 * FORBIDDEN from: completed, dismissed (terminal)
 */
export async function acknowledgeDeadline(
  ctx: WriteContext,
  deadlineId: string
): Promise<ServiceResult<Deadline>> {
  const deadlineResult = await findDeadlineById(ctx.db, ctx.organizationId, deadlineId)
  if (!deadlineResult.success) return notFoundError('Deadline not found.')

  const deadline = deadlineResult.data

  if (isTerminalDeadlineState(deadline.status)) {
    return conflictError(
      `Deadline is in terminal state '${deadline.status}' and cannot be acknowledged.`
    )
  }
  if (deadline.status === 'acknowledged') {
    return conflictError('Deadline is already acknowledged.')
  }

  try {
    const updated = await withTx(ctx.db, async (tx) => {
      const now = new Date()
      const previous = deadline.status

      const updateResult = unwrapOrThrow(
        await updateDeadlineStatus(tx, ctx.organizationId, deadlineId, {
          status: 'acknowledged',
          acknowledgedAt: now,
          acknowledgedByUserId: ctx.userId,
          updatedAt: now,
        })
      )

      // Append history record
      unwrapOrThrow(
        await appendDeadlineHistory(tx, {
          organizationId: ctx.organizationId,
          deadlineId,
          changeType: 'acknowledged',
          previousValue: { status: previous },
          newValue: { status: 'acknowledged' },
          ...deadlineHistoryUserActor(ctx.userId),
          correlationId: ctx.correlationId,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'acknowledged',
        entityType: 'Deadline',
        entityId: deadlineId,
        changes: { type: 'state_transition', previous, next: 'acknowledged' },
        eventType: 'deadline.acknowledged',
        aggregateType: 'Deadline',
        aggregateId: deadlineId,
        occurredAt: now,
        eventPayload: {
          deadlineId,
          organizationId: ctx.organizationId,
          previousStatus: previous,
          status: 'acknowledged',
          acknowledgedByUserId: ctx.userId,
        },
      })

      return updateResult
    })

    return ok(updated)
  } catch (err) {
    console.error('[deadline.service] acknowledgeDeadline failed:', err)
    return internalServiceError('Failed to acknowledge deadline.', err)
  }
}

/**
 * Complete a deadline.
 * Transition: open | acknowledged | overdue → completed (terminal)
 *
 * Completion evidence is optional but strongly encouraged for legal deadlines.
 * The service does NOT enforce evidence for all classes (that is Phase 6+ policy).
 */
export async function completeDeadline(
  ctx: WriteContext,
  deadlineId: string,
  input: CompleteDeadlineInput
): Promise<ServiceResult<Deadline>> {
  const deadlineResult = await findDeadlineById(ctx.db, ctx.organizationId, deadlineId)
  if (!deadlineResult.success) return notFoundError('Deadline not found.')

  const deadline = deadlineResult.data

  if (isTerminalDeadlineState(deadline.status)) {
    return conflictError(
      `Deadline is already in terminal state '${deadline.status}'. Cannot complete.`
    )
  }

  try {
    const updated = await withTx(ctx.db, async (tx) => {
      const now = new Date()
      const previous = deadline.status

      const updateResult = unwrapOrThrow(
        await updateDeadlineStatus(tx, ctx.organizationId, deadlineId, {
          status: 'completed',
          completedAt: now,
          completedByUserId: ctx.userId,
          ...(input.completionEvidenceType !== undefined
            ? { completionEvidenceType: input.completionEvidenceType }
            : {}),
          ...(input.completionEvidenceId !== undefined
            ? { completionEvidenceId: input.completionEvidenceId }
            : {}),
          updatedAt: now,
        })
      )

      unwrapOrThrow(
        await appendDeadlineHistory(tx, {
          organizationId: ctx.organizationId,
          deadlineId,
          changeType: 'completed',
          previousValue: { status: previous },
          newValue: {
            status: 'completed',
            completionEvidenceType: input.completionEvidenceType ?? null,
            completionEvidenceId: input.completionEvidenceId ?? null,
          },
          reason: input.reason?.trim() || null,
          ...deadlineHistoryUserActor(ctx.userId),
          correlationId: ctx.correlationId,
        })
      )

      // Timeline event for the case
      unwrapOrThrow(await appendTimelineEvent(tx, {
        organizationId: ctx.organizationId,
        executionCaseId: deadline.executionCaseId,
        eventType: 'deadline.completed',
        eventCategory: 'internal',
        occurredAt: now,
        summary: `Deadline completed: "${deadline.title}".`,
        payload: {
          deadlineId,
          deadlineClass: deadline.deadlineClass,
          completionEvidenceType: input.completionEvidenceType ?? null,
          completionEvidenceId: input.completionEvidenceId ?? null,
        },
        source: 'manual',
        actorType: 'user',
        actorId: ctx.actor.actorId,
        authorUserId: ctx.userId,
        visibility: 'internal',
        sourceRefType: 'Deadline',
        sourceRefId: deadlineId,
      }))

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'completed',
        entityType: 'Deadline',
        entityId: deadlineId,
        changes: { type: 'state_transition', previous, next: 'completed' },
        eventType: 'deadline.completed',
        aggregateType: 'Deadline',
        aggregateId: deadlineId,
        occurredAt: now,
        eventPayload: {
          deadlineId,
          organizationId: ctx.organizationId,
          previousStatus: previous,
          status: 'completed',
          completedByUserId: ctx.userId,
          completionEvidenceType: input.completionEvidenceType ?? null,
        },
      })

      return updateResult
    })

    return ok(updated)
  } catch (err) {
    console.error('[deadline.service] completeDeadline failed:', err)
    return internalServiceError('Failed to complete deadline.', err)
  }
}

/**
 * Dismiss a deadline.
 * Transition: open | acknowledged | overdue → dismissed (terminal)
 *
 * LAWYER-ONLY for overdue deadlines (enforced at route level with requireMinRole('lawyer')).
 * dismissedReason is mandatory — no silent dismissals.
 * dismissedReasonCode is required for overdue dismissals (enforced here).
 */
export async function dismissDeadline(
  ctx: WriteContext,
  deadlineId: string,
  input: DismissDeadlineInput
): Promise<ServiceResult<Deadline>> {
  if (!input.dismissedReason.trim()) {
    return validationError('Dismissal reason is required.', 'dismissedReason')
  }

  const deadlineResult = await findDeadlineById(ctx.db, ctx.organizationId, deadlineId)
  if (!deadlineResult.success) return notFoundError('Deadline not found.')

  const deadline = deadlineResult.data

  if (isTerminalDeadlineState(deadline.status)) {
    return conflictError(
      `Deadline is already in terminal state '${deadline.status}'. Cannot dismiss.`
    )
  }

  // For overdue deadlines: require a reason code
  if (deadline.status === 'overdue' && !input.dismissedReasonCode) {
    return validationError(
      'Overdue deadline dismissal requires a dismissedReasonCode. ' +
      'Acceptable values: completed_elsewhere, superseded, not_applicable, court_extension, client_withdrawal, other.',
      'dismissedReasonCode'
    )
  }

  try {
    const updated = await withTx(ctx.db, async (tx) => {
      const now = new Date()
      const previous = deadline.status

      const updateResult = unwrapOrThrow(
        await updateDeadlineStatus(tx, ctx.organizationId, deadlineId, {
          status: 'dismissed',
          dismissedAt: now,
          dismissedByUserId: ctx.userId,
          dismissedReason: input.dismissedReason.trim(),
          ...(input.dismissedReasonCode !== undefined
            ? { dismissedReasonCode: input.dismissedReasonCode }
            : {}),
          updatedAt: now,
        })
      )

      unwrapOrThrow(
        await appendDeadlineHistory(tx, {
          organizationId: ctx.organizationId,
          deadlineId,
          changeType: 'dismissed',
          previousValue: { status: previous },
          newValue: {
            status: 'dismissed',
            dismissedReason: input.dismissedReason.trim(),
            dismissedReasonCode: input.dismissedReasonCode ?? null,
          },
          reason: input.dismissedReason.trim(),
          ...deadlineHistoryUserActor(ctx.userId),
          correlationId: ctx.correlationId,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'dismissed',
        entityType: 'Deadline',
        entityId: deadlineId,
        changes: {
          type: 'state_transition',
          previous,
          next: 'dismissed',
          reason: input.dismissedReason.trim(),
        },
        eventType: 'deadline.dismissed',
        aggregateType: 'Deadline',
        aggregateId: deadlineId,
        occurredAt: now,
        eventPayload: {
          deadlineId,
          organizationId: ctx.organizationId,
          previousStatus: previous,
          status: 'dismissed',
          dismissedByUserId: ctx.userId,
          dismissedReasonCode: input.dismissedReasonCode ?? null,
        },
      })

      return updateResult
    })

    return ok(updated)
  } catch (err) {
    console.error('[deadline.service] dismissDeadline failed:', err)
    return internalServiceError('Failed to dismiss deadline.', err)
  }
}
