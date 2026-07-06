/**
 * Event consumers for Opportunity domain events.
 *
 * REGISTERED CONSUMERS:
 * - opportunity.created    → create queue projection in appropriate queue
 * - opportunity.qualified  → move from suggestion queue to action queue
 * - opportunity.reviewed   → update queue metadata
 * - opportunity.deferred   → set deferred status on queue projection
 * - opportunity.dismissed  → resolve queue projection
 *
 * QUEUE ROUTING BY OPPORTUNITY TYPE:
 * - type=progression: progression_opportunities queue (lawyer-first)
 * - all others: opportunity_review queue (assistant triage first)
 *
 * Architecture ref: office-operating-system.md §2.1 (queue catalog),
 *                   event-state-architecture.md §3.4 (opportunity state machine).
 */

import type { Job } from 'pg-boss'
import { sql } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'
import {
  upsertQueueProjection,
  resolveQueueProjection,
} from '../projections/queue-projection.ts'
import { createOpportunityReviewTask } from '../projections/workflow-task.ts'

type OpportunityEventJob = Job<{
  eventId: string
  eventType: string
  payload: Record<string, unknown>
  occurredAt: string
  organizationId: string | null
  correlationId: string
  causationId: string | null
}>

/**
 * Returns the appropriate queue type for a new opportunity.
 */
function routeOpportunityToQueue(
  opportunityType: string,
  confidenceLevel: string
): string {
  if (opportunityType === 'progression') return 'progression_opportunities'
  return 'opportunity_review'
}

/**
 * Derives queue priority from opportunity confidence level.
 */
function deriveOpportunityPriority(
  opportunityType: string,
  confidenceLevel: string
): number {
  if (
    opportunityType === 'excess_execution' ||
    opportunityType === 'hc'
  ) {
    return 1
  }
  if (confidenceLevel === 'high') return 1
  if (confidenceLevel === 'medium') return 2
  return 3
}

/**
 * Handles opportunity.created events (status = 'suggested').
 *
 * Creates a queue projection in the appropriate queue.
 * Also creates an assistant triage task for non-progression, non-critical opportunities.
 */
export async function handleOpportunityCreated(
  db: WorkersDb,
  job: OpportunityEventJob
): Promise<void> {
  const { payload, organizationId, eventId } = job.data

  if (!organizationId) return

  const opportunityId = payload['opportunityId'] as string | undefined
  const opportunityType = (payload['opportunityType'] as string | undefined) ?? 'manual'
  const summary = payload['summary'] as string | null | undefined
  const confidenceLevel = (payload['confidenceLevel'] as string | undefined) ?? 'medium'
  const executionCaseId = payload['executionCaseId'] as string | undefined
  const windowEndAt = payload['windowEndAt'] as string | undefined

  if (!opportunityId) return

  const queueType = routeOpportunityToQueue(opportunityType, confidenceLevel)
  const queuePriority = deriveOpportunityPriority(opportunityType, confidenceLevel)

  const slaDeadlineAt = (() => {
    if (windowEndAt) return new Date(windowEndAt)
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  })()

  await upsertQueueProjection(db, {
    organizationId,
    queueType,
    entityType: 'Opportunity',
    entityId: opportunityId,
    ...(executionCaseId !== undefined ? { executionCaseId } : {}),
    priority: queuePriority,
    displayTitle: summary ?? `Oportunidade: ${opportunityType}`,
    displayLabel: opportunityType,
    ...(windowEndAt !== undefined ? { keyDate: new Date(windowEndAt) } : {}),
    slaDeadlineAt,
    sourceCausingEventId: eventId,
    metadata: {
      opportunityType,
      confidenceLevel,
      status: 'suggested',
    },
  })

  if (queueType === 'opportunity_review') {
    await createOpportunityReviewTask(db, {
      organizationId,
      executionCaseId: executionCaseId,
      opportunityId,
      opportunityType,
      opportunitySummary: summary ?? null,
      causingEventId: eventId,
    })
  }

  // Publish notification event (consumed by the email/WhatsApp notifier)
  if (executionCaseId) {
    const { domainEvents } = await import('@execflow/db/schema')
    const crypto = await import('crypto')
    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      eventType: 'whatsapp.notification.requested',
      aggregateType: 'ExecutionCase',
      aggregateId: executionCaseId,
      actorType: 'system',
      actorId: 'worker.opportunity-consumer',
      payload: {
        notificationType: 'opportunity_detected',
        executionCaseId,
        opportunityType,
        summary: summary ?? 'Uma nova oportunidade foi detectada no caso.',
      },
      correlationId: job.data.correlationId,
      causationId: eventId,
      occurredAt: new Date(),
    })
  }
}

/**
 * Handles opportunity.qualified events.
 *
 * Resolves the suggestion queue entry (lawyer has qualified it; it no longer
 * needs initial review). The opportunity now moves to an "active pursuit"
 * workflow — tracked separately when piece drafting begins.
 */
export async function handleOpportunityQualified(
  db: WorkersDb,
  job: OpportunityEventJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const opportunityId = payload['opportunityId'] as string | undefined
  const opportunityType = (payload['opportunityType'] as string | undefined) ?? 'manual'

  if (!opportunityId) return

  const queueType = routeOpportunityToQueue(opportunityType, 'high')

  await resolveQueueProjection(db, {
    organizationId,
    queueType,
    entityType: 'Opportunity',
    entityId: opportunityId,
  })
}

/**
 * Handles opportunity.reviewed events.
 * Updates the queue projection metadata to reflect review state.
 */
export async function handleOpportunityReviewed(
  db: WorkersDb,
  job: OpportunityEventJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const opportunityId = payload['opportunityId'] as string | undefined
  const reviewAction = payload['reviewAction'] as string | undefined
  const opportunityType = (payload['opportunityType'] as string | undefined) ?? 'manual'

  if (!opportunityId) return

  if (reviewAction === 'rejected' || reviewAction === 'realized') {
    const queueType = routeOpportunityToQueue(opportunityType, 'high')
    await resolveQueueProjection(db, {
      organizationId,
      queueType,
      entityType: 'Opportunity',
      entityId: opportunityId,
    })
  }
}

/**
 * Handles opportunity.deferred events.
 * Sets the deferred status on the queue projection.
 */
export async function handleOpportunityDeferred(
  db: WorkersDb,
  job: OpportunityEventJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const opportunityId = payload['opportunityId'] as string | undefined
  const opportunityType = (payload['opportunityType'] as string | undefined) ?? 'manual'
  const deferredUntil = payload['deferredUntil'] as string | undefined

  if (!opportunityId || !deferredUntil) return

  const { queueProjections } = await import('@execflow/db/schema')

  await db
    .update(queueProjections)
    .set({
      status: 'deferred',
      deferredUntil: new Date(deferredUntil),
      updatedAt: new Date(),
    })
    .where(
      sql`
        organization_id = ${organizationId}::uuid
        AND entity_type = 'Opportunity'
        AND entity_id = ${opportunityId}::uuid
        AND status != 'resolved'
      `
    )
}

/**
 * Handles opportunity.dismissed events.
 * Resolves queue projections for this opportunity in all queues.
 */
export async function handleOpportunityDismissed(
  db: WorkersDb,
  job: OpportunityEventJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const opportunityId = payload['opportunityId'] as string | undefined
  const opportunityType = (payload['opportunityType'] as string | undefined) ?? 'manual'

  if (!opportunityId) return

  for (const queueType of ['opportunity_review', 'progression_opportunities'] as const) {
    await resolveQueueProjection(db, {
      organizationId,
      queueType,
      entityType: 'Opportunity',
      entityId: opportunityId,
    })
  }
}
