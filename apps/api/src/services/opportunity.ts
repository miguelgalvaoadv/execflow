/**
 * Opportunity service — domain operations for the Opportunity entity.
 *
 * STATE MACHINE ENFORCEMENT:
 * This service is the authoritative enforcement point for all opportunity transitions.
 * No code outside this service may change opportunity.status directly.
 *
 * HUMAN GATE (non-negotiable):
 * Every status transition writes an OpportunityReview row (the human's decision record)
 * AND an OpportunityStatusHistory row (the state machine transition record)
 * in the same transaction. A transition without a review record is an architecture defect.
 *
 * TERMINAL STATE PROTECTION:
 * realized, dismissed, expired are terminal. Enforced at the start of every method.
 *
 * LAWYER-ONLY TRANSITIONS (enforced at route layer + service layer):
 * - suggested → qualified: lawyer only
 * - suggested | qualified | pursuing → dismissed: lawyer only
 * - pursuing → realized: lawyer only
 *
 * EXPLANATION REQUIRED:
 * All review actions require a non-empty explanation. Enforced before any write.
 *
 * Architecture ref: execution-workflows.md §5.4, data-model-v1.md §2.9,
 *                   AI_BOUNDARIES.md (human gate requirement).
 */

import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { findCaseById } from '../repositories/execution-case.ts'
import { insertOpportunity, findOpportunityById, updateOpportunityStatus } from '../repositories/opportunity.ts'
import { appendOpportunityReview } from '../repositories/opportunity-review.ts'
import { appendOpportunityStatusHistory } from '../repositories/opportunity-status-history.ts'
import { appendTimelineEvent } from '../repositories/timeline-event.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import {
  ok,
  validationError,
  notFoundError,
  conflictError,
  forbiddenError,
  internalServiceError,
} from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import type { Opportunity } from '@execflow/db/schema'
import type {
  OpportunityType,
  OpportunityStatus,
  ConfidenceLevel,
} from '@execflow/db/types'

// ---------------------------------------------------------------------------
// Terminal state helpers
// ---------------------------------------------------------------------------

const TERMINAL_OPP_STATES = new Set<OpportunityStatus>(['realized', 'dismissed', 'expired'])

function isTerminalOppState(status: OpportunityStatus): boolean {
  return TERMINAL_OPP_STATES.has(status)
}

// Valid transitions map (from → set of valid to states)
const VALID_TRANSITIONS: Record<OpportunityStatus, Set<OpportunityStatus>> = {
  suggested:  new Set(['qualified', 'dismissed', 'expired']),
  qualified:  new Set(['pursuing', 'dismissed', 'expired']),
  pursuing:   new Set(['realized', 'dismissed', 'expired']),
  realized:   new Set(),
  dismissed:  new Set(),
  expired:    new Set(),
}

function isValidTransition(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return VALID_TRANSITIONS[from]?.has(to) ?? false
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateOpportunityInput = {
  executionCaseId: string
  opportunityType: OpportunityType
  summary: string
  rationale?: string | undefined
  confidenceLevel?: ConfidenceLevel | undefined
  windowStartAt?: string | undefined
  windowEndAt?: string | undefined
  legalBasis?: string | undefined
  sentenceSnapshotId?: string | undefined
  sourceEventId?: string | undefined
  playbookVersionId?: string | undefined
  blockingConditions?: Array<{condition: string; type: string; entityRef?: string | undefined}> | undefined
  requiredDocuments?: Array<{required: string; reason: string; urgency: string}> | undefined
  missingDataFields?: Array<{field: string; source: string; reason: string}> | undefined
  uncertaintyFlags?: Array<{factor: string; impact: string; description: string}> | undefined
  requiresReview?: boolean | undefined
}

export type ReviewOpportunityInput = {
  /**
   * The action being taken.
   * 'qualified': lawyer promotes suggested → qualified
   * 'rejected': lawyer dismisses the opportunity
   * 'changes_requested': reviewer requests more data
   * 'deferred': postpone review until a later date
   * 'escalated': hand off to another reviewer
   * 'pursuing_started': qualified → pursuing
   * 'realized': pursuing → realized (links piece)
   */
  reviewAction: 'qualified' | 'rejected' | 'changes_requested' | 'deferred' | 'escalated' | 'pursuing_started' | 'realized'

  /** MANDATORY for all actions. Rationale for the decision. */
  explanation: string

  /** Required when reviewAction = 'rejected'. */
  rejectionReasonCode?: string | undefined

  /** Required when reviewAction = 'deferred'. ISO 8601 datetime. */
  deferredUntil?: string | undefined

  /** Required when reviewAction = 'escalated'. UUID of target user. */
  escalatedToUserId?: string | undefined

  /** Required when reviewAction = 'realized'. UUID of the PieceDraft. */
  realizedPieceDraftId?: string | undefined

  /** Optional: structured data snapshot used in the decision. */
  dataSnapshotRef?: Record<string, unknown> | undefined
}

export type DeferOpportunityInput = {
  deferredUntil: string  // ISO 8601
  explanation: string
}

// ---------------------------------------------------------------------------
// Opportunity-to-status mapping for review actions
// ---------------------------------------------------------------------------

function reviewActionToNewStatus(
  currentStatus: OpportunityStatus,
  action: ReviewOpportunityInput['reviewAction']
): OpportunityStatus | null {
  switch (action) {
    case 'qualified':         return currentStatus === 'suggested' ? 'qualified' : null
    case 'rejected':          return 'dismissed'
    case 'pursuing_started':  return currentStatus === 'qualified' ? 'pursuing' : null
    case 'realized':          return currentStatus === 'pursuing' ? 'realized' : null
    // These don't change status directly:
    case 'changes_requested': return null
    case 'deferred':          return null
    case 'escalated':         return null
    default:                  return null
  }
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

/**
 * Create a new opportunity (manual or system-generated).
 *
 * Validation:
 * - executionCaseId must exist in this org
 * - summary is required
 * - opportunityType is required
 *
 * Writes atomically: Opportunity + TimelineEvent + AuditLog + DomainEvent.
 */
export async function createOpportunity(
  ctx: WriteContext,
  input: CreateOpportunityInput
): Promise<ServiceResult<Opportunity>> {
  if (!input.summary.trim()) {
    return validationError('Opportunity summary is required.', 'summary')
  }
  if (!input.executionCaseId) {
    return validationError('executionCaseId is required.', 'executionCaseId')
  }

  // Validate window dates if provided
  let windowStartAt: Date | undefined
  let windowEndAt: Date | undefined

  if (input.windowStartAt) {
    windowStartAt = new Date(input.windowStartAt)
    if (isNaN(windowStartAt.getTime())) {
      return validationError('windowStartAt must be a valid ISO 8601 datetime.', 'windowStartAt')
    }
  }
  if (input.windowEndAt) {
    windowEndAt = new Date(input.windowEndAt)
    if (isNaN(windowEndAt.getTime())) {
      return validationError('windowEndAt must be a valid ISO 8601 datetime.', 'windowEndAt')
    }
  }
  if (windowStartAt && windowEndAt && windowStartAt >= windowEndAt) {
    return validationError('windowEndAt must be after windowStartAt.', 'windowEndAt')
  }

  // Verify case exists
  const caseResult = await findCaseById(ctx.db, ctx.organizationId, input.executionCaseId)
  if (!caseResult.success) {
    return notFoundError('Execution case not found in this organization.')
  }

  const hasBlockingConditions = (input.blockingConditions?.length ?? 0) > 0

  try {
    const opportunity = await withTx(ctx.db, async (tx) => {
      const now = new Date()

      const oppResult = unwrapOrThrow(
        await insertOpportunity(tx, {
          organizationId: ctx.organizationId,
          executionCaseId: input.executionCaseId,
          opportunityType: input.opportunityType,
          status: 'suggested',
          detectedAt: now,
          summary: input.summary.trim(),
          rationale: input.rationale?.trim(),
          confidenceLevel: input.confidenceLevel,
          windowStartAt,
          windowEndAt,
          legalBasis: input.legalBasis?.trim(),
          sentenceSnapshotId: input.sentenceSnapshotId,
          sourceEventId: input.sourceEventId,
          playbookVersionId: input.playbookVersionId,
          blockingConditions: input.blockingConditions ?? null,
          requiredDocuments: input.requiredDocuments ?? null,
          missingDataFields: input.missingDataFields ?? null,
          uncertaintyFlags: input.uncertaintyFlags ?? null,
          requiresReview: input.requiresReview ?? true,
          isPendingReview: input.requiresReview ?? true,
          isBlocked: hasBlockingConditions,
          isStale: false,
          createdAt: now,
          createdByUserId: ctx.userId,
          updatedAt: now,
        })
      )

      // Append status history (initial state)
      unwrapOrThrow(
        await appendOpportunityStatusHistory(tx, {
          organizationId: ctx.organizationId,
          opportunityId: oppResult.id,
          previousStatus: 'suggested', // same as initial — this is the "created" record
          newStatus: 'suggested',
          changedByActorType: ctx.actor.actorType,
          changedByActorId: ctx.actor.actorId,
          reason: 'Initial creation',
          correlationId: ctx.correlationId,
        })
      )

      // Append timeline event
      unwrapOrThrow(await appendTimelineEvent(tx, {
        organizationId: ctx.organizationId,
        executionCaseId: input.executionCaseId,
        eventType: 'opportunity.suggested',
        eventCategory: 'internal',
        occurredAt: now,
        summary: `Opportunity suggested: ${input.opportunityType} — ${input.summary.trim()}`,
        payload: {
          opportunityId: oppResult.id,
          opportunityType: input.opportunityType,
          confidenceLevel: input.confidenceLevel ?? null,
          hasBlockingConditions,
        },
        source: 'manual',
        actorType: 'user',
        actorId: ctx.actor.actorId,
        authorUserId: ctx.userId,
        visibility: 'internal',
        sourceRefType: 'Opportunity',
        sourceRefId: oppResult.id,
      }))

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'Opportunity',
        entityId: oppResult.id,
        changes: {
          type: 'creation',
          snapshot: {
            status: 'suggested',
            opportunityType: input.opportunityType,
            confidenceLevel: input.confidenceLevel ?? null,
          },
        },
        eventType: 'opportunity.created',
        aggregateType: 'Opportunity',
        aggregateId: oppResult.id,
        occurredAt: now,
        eventPayload: {
          opportunityId: oppResult.id,
          executionCaseId: input.executionCaseId,
          organizationId: ctx.organizationId,
          opportunityType: input.opportunityType,
          status: 'suggested',
          confidenceLevel: input.confidenceLevel ?? null,
          hasBlockingConditions,
          requiresReview: input.requiresReview ?? true,
          createdByUserId: ctx.userId,
        },
      })

      return oppResult
    })

    return ok(opportunity)
  } catch (err) {
    console.error('[opportunity.service] createOpportunity failed:', err)
    return internalServiceError('Failed to create opportunity.', err)
  }
}

/**
 * Review an opportunity (qualify, reject, defer, escalate, start pursuing, realize).
 *
 * This is the primary mutation method for the opportunity state machine.
 * Every call produces:
 * - An OpportunityReview row (human decision record)
 * - An OpportunityStatusHistory row (state machine record)
 * - An AuditLog entry
 * - A DomainEvent
 * - A TimelineEvent on the case
 *
 * EXPLANATION IS MANDATORY. The service rejects empty explanations.
 *
 * LAWYER-ONLY: qualified, rejected, pursuing_started, realized are lawyer-only
 * transitions. This is enforced at the route layer via requireMinRole('lawyer').
 */
export async function reviewOpportunity(
  ctx: WriteContext,
  opportunityId: string,
  input: ReviewOpportunityInput
): Promise<ServiceResult<Opportunity>> {
  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  if (!input.explanation.trim()) {
    return validationError(
      'Explanation is mandatory for all opportunity review actions. Please provide your rationale.',
      'explanation'
    )
  }

  if (input.reviewAction === 'rejected' && !input.rejectionReasonCode) {
    return validationError(
      'rejectionReasonCode is required when rejecting an opportunity.',
      'rejectionReasonCode'
    )
  }

  if (input.reviewAction === 'deferred') {
    if (!input.deferredUntil) {
      return validationError('deferredUntil is required when deferring an opportunity.', 'deferredUntil')
    }
    const deferDate = new Date(input.deferredUntil)
    if (isNaN(deferDate.getTime())) {
      return validationError('deferredUntil must be a valid ISO 8601 datetime.', 'deferredUntil')
    }
    if (deferDate <= new Date()) {
      return validationError('deferredUntil must be in the future.', 'deferredUntil')
    }
  }

  if (input.reviewAction === 'escalated' && !input.escalatedToUserId) {
    return validationError('escalatedToUserId is required when escalating.', 'escalatedToUserId')
  }

  // -------------------------------------------------------------------------
  // Load and validate current state
  // -------------------------------------------------------------------------

  const oppResult = await findOpportunityById(ctx.db, ctx.organizationId, opportunityId)
  if (!oppResult.success) return notFoundError('Opportunity not found.')

  const opp = oppResult.data

  if (isTerminalOppState(opp.status)) {
    return conflictError(
      `Opportunity is in terminal state '${opp.status}'. No further transitions are allowed.`
    )
  }

  // Determine the new status (null for non-status-changing actions like defer/escalate)
  const newStatus = reviewActionToNewStatus(opp.status, input.reviewAction)

  // Validate the transition is legal
  if (newStatus !== null && !isValidTransition(opp.status, newStatus)) {
    return conflictError(
      `Cannot transition from '${opp.status}' to '${newStatus}' with action '${input.reviewAction}'.`
    )
  }

  // realized requires a piece reference
  if (input.reviewAction === 'realized' && !input.realizedPieceDraftId) {
    return validationError(
      'realizedPieceDraftId is required when marking an opportunity as realized.',
      'realizedPieceDraftId'
    )
  }

  // -------------------------------------------------------------------------
  // Transactional write
  // -------------------------------------------------------------------------

  try {
    const updated = await withTx(ctx.db, async (tx) => {
      const now = new Date()
      const previousStatus = opp.status

      // Write the review record (append-only, mandatory)
      const reviewResult = unwrapOrThrow(
        await appendOpportunityReview(tx, {
          organizationId: ctx.organizationId,
          opportunityId,
          reviewAction: input.reviewAction,
          reviewerUserId: ctx.userId,
          explanation: input.explanation.trim(),
          rejectionReasonCode: input.rejectionReasonCode,
          deferredUntil: input.deferredUntil ? new Date(input.deferredUntil) : undefined,
          escalatedToUserId: input.escalatedToUserId,
          opportunityStatusAtReview: opp.status,
          confidenceLevelAtReview: opp.confidenceLevel ?? undefined,
          dataSnapshotRef: input.dataSnapshotRef ?? null,
          correlationId: ctx.correlationId,
        })
      )

      // Write status history (always, even for non-status-changing actions)
      unwrapOrThrow(
        await appendOpportunityStatusHistory(tx, {
          organizationId: ctx.organizationId,
          opportunityId,
          previousStatus,
          newStatus: newStatus ?? previousStatus,
          changedByActorType: ctx.actor.actorType,
          changedByActorId: ctx.actor.actorId,
          reason: input.explanation.trim(),
          reviewId: reviewResult.id,
          correlationId: ctx.correlationId,
          metadata: { reviewAction: input.reviewAction },
        })
      )

      // Update opportunity status (and related fields) if status changes
      let updatedOpp = opp
      if (newStatus !== null) {
        const statusParams: Parameters<typeof updateOpportunityStatus>[3] = {
          status: newStatus,
          isPendingReview: false,
          updatedAt: now,
        }

        if (newStatus === 'qualified') {
          statusParams.qualifiedAt = now
          statusParams.qualifiedByUserId = ctx.userId
        }
        if (newStatus === 'dismissed') {
          statusParams.dismissedAt = now
          statusParams.dismissedByUserId = ctx.userId
          statusParams.dismissedReason = input.explanation.trim()
        }
        if (newStatus === 'realized' && input.realizedPieceDraftId) {
          statusParams.realizedPieceDraftId = input.realizedPieceDraftId
        }

        updatedOpp = unwrapOrThrow(
          await updateOpportunityStatus(tx, ctx.organizationId, opportunityId, statusParams)
        )
      } else {
        // For defer/escalate/changes_requested — clear isPendingReview
        updatedOpp = unwrapOrThrow(
          await updateOpportunityStatus(tx, ctx.organizationId, opportunityId, {
            status: previousStatus,
            isPendingReview: false,
            updatedAt: now,
          })
        )
      }

      // Determine the event type for timeline + domain events
      const timelineEventType = newStatus
        ? `opportunity.${newStatus === 'dismissed' ? 'dismissed' : newStatus === 'qualified' ? 'qualified' : newStatus === 'pursuing' ? 'pursuing_started' : newStatus === 'realized' ? 'realized' : 'reviewed'}`
        : `opportunity.${input.reviewAction}`

      // Append timeline event
      unwrapOrThrow(await appendTimelineEvent(tx, {
        organizationId: ctx.organizationId,
        executionCaseId: opp.executionCaseId,
        eventType: timelineEventType,
        eventCategory: 'internal',
        occurredAt: now,
        summary: buildTimelineSummary(input.reviewAction, opp, input.explanation),
        payload: {
          opportunityId,
          opportunityType: opp.opportunityType,
          reviewAction: input.reviewAction,
          previousStatus,
          newStatus: newStatus ?? previousStatus,
          reviewId: reviewResult.id,
        },
        source: 'manual',
        actorType: 'user',
        actorId: ctx.actor.actorId,
        authorUserId: ctx.userId,
        visibility: 'internal',
        sourceRefType: 'Opportunity',
        sourceRefId: opportunityId,
      }))

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: input.reviewAction,
        entityType: 'Opportunity',
        entityId: opportunityId,
        changes: newStatus
          ? { type: 'state_transition', previous: previousStatus, next: newStatus }
          : { type: 'field_update', fields: { reviewAction: { previous: null, next: input.reviewAction } } },
        eventType: `opportunity.${input.reviewAction}`,
        aggregateType: 'Opportunity',
        aggregateId: opportunityId,
        occurredAt: now,
        eventPayload: {
          opportunityId,
          organizationId: ctx.organizationId,
          opportunityType: opp.opportunityType,
          reviewAction: input.reviewAction,
          previousStatus,
          newStatus: newStatus ?? previousStatus,
          reviewId: reviewResult.id,
          reviewerUserId: ctx.userId,
        },
      })

      return updatedOpp
    })

    return ok(updated)
  } catch (err) {
    console.error('[opportunity.service] reviewOpportunity failed:', err)
    return internalServiceError('Failed to review opportunity.', err)
  }
}

/**
 * Convenience wrapper for deferred review.
 * Internally delegates to reviewOpportunity with action='deferred'.
 */
export async function deferOpportunity(
  ctx: WriteContext,
  opportunityId: string,
  input: DeferOpportunityInput
): Promise<ServiceResult<Opportunity>> {
  return reviewOpportunity(ctx, opportunityId, {
    reviewAction: 'deferred',
    explanation: input.explanation,
    deferredUntil: input.deferredUntil,
  })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildTimelineSummary(
  action: ReviewOpportunityInput['reviewAction'],
  opp: Opportunity,
  explanation: string
): string {
  const typeLabel = opp.opportunityType.replace('_', ' ')
  switch (action) {
    case 'qualified':       return `Opportunity qualified: ${typeLabel}.`
    case 'rejected':        return `Opportunity dismissed: ${typeLabel}.`
    case 'changes_requested': return `Changes requested on ${typeLabel} opportunity.`
    case 'deferred':        return `Opportunity deferred: ${typeLabel}.`
    case 'escalated':       return `Opportunity escalated: ${typeLabel}.`
    case 'pursuing_started': return `Pursuing opportunity: ${typeLabel}.`
    case 'realized':        return `Opportunity realized: ${typeLabel}.`
    default:                return `Opportunity reviewed: ${typeLabel}.`
  }
}
