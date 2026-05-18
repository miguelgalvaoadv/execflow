/**
 * Queue projection update functions.
 *
 * These functions are called by event consumers to maintain the queue_projections
 * table — the materialized, replay-safe view of active queue items.
 *
 * IDEMPOTENCY:
 * All write operations use INSERT ... ON CONFLICT DO UPDATE, keyed on the
 * natural unique index (organization_id, queue_type, entity_type, entity_id).
 * This makes all projection writes safe to replay from domain events.
 *
 * REPLAY CONTRACT:
 * Given the same sequence of domain events, these functions always produce the
 * same queue_projections state. The projection table can be rebuilt entirely by:
 *   1. DELETE FROM queue_projections WHERE organization_id = $orgId
 *   2. Replay all domain_events for $orgId in occurred_at order
 *   3. Apply the corresponding consumer for each event type
 *
 * Architecture ref: event-state-architecture.md §2.10 (replay behavior).
 */

import { sql } from '@execflow/db/client'
import type { WorkersDb, WorkersTx } from '../lib/db.ts'

type DbOrTx = WorkersDb | WorkersTx

/**
 * Parameters for creating or activating a queue projection entry.
 */
export type UpsertQueueProjectionParams = {
  organizationId: string
  queueType: string
  entityType: string
  entityId: string
  executionCaseId?: string
  priority?: number
  displayTitle: string
  displayLabel?: string
  keyDate?: Date
  slaDeadlineAt?: Date
  assigneeUserId?: string
  responsibleLawyerUserId?: string
  sourceCausingEventId?: string
  metadata?: Record<string, unknown>
}

/**
 * Creates a new queue projection entry or updates an existing one (upsert).
 *
 * UPSERT SEMANTICS:
 * - If no entry exists: creates one with status = 'active'
 * - If entry exists with status = 'resolved': creates a NEW one (different entity event)
 *   → actually, the unique constraint prevents this; "resolved" entries must be manually
 *   cleared or the entity must produce a new queue entry via a new event
 * - If entry exists and active/snoozed/deferred/blocked: updates the mutable fields
 *
 * The ON CONFLICT DO UPDATE handles the common case (idempotent re-processing).
 */
export async function upsertQueueProjection(
  db: DbOrTx,
  params: UpsertQueueProjectionParams
): Promise<void> {
  const { queueProjections } = await import('@execflow/db/schema')
  const now = new Date()

  await db
    .insert(queueProjections)
    .values({
      organizationId: params.organizationId,
      queueType: params.queueType as typeof queueProjections.$inferInsert['queueType'],
      entityType: params.entityType,
      entityId: params.entityId,
      ...(params.executionCaseId !== undefined ? { executionCaseId: params.executionCaseId } : {}),
      status: 'active',
      priority: params.priority ?? 2,
      displayTitle: params.displayTitle,
      ...(params.displayLabel !== undefined ? { displayLabel: params.displayLabel } : {}),
      ...(params.keyDate !== undefined ? { keyDate: params.keyDate } : {}),
      ...(params.slaDeadlineAt !== undefined ? { slaDeadlineAt: params.slaDeadlineAt } : {}),
      ...(params.assigneeUserId !== undefined ? { assigneeUserId: params.assigneeUserId } : {}),
      ...(params.responsibleLawyerUserId !== undefined
        ? { responsibleLawyerUserId: params.responsibleLawyerUserId }
        : {}),
      ...(params.sourceCausingEventId !== undefined
        ? { sourceCausingEventId: params.sourceCausingEventId }
        : {}),
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        queueProjections.organizationId,
        queueProjections.queueType,
        queueProjections.entityType,
        queueProjections.entityId,
      ],
      set: {
        status: 'active',
        priority: params.priority ?? 2,
        displayTitle: params.displayTitle,
        ...(params.displayLabel !== undefined ? { displayLabel: params.displayLabel } : {}),
        ...(params.keyDate !== undefined ? { keyDate: params.keyDate } : {}),
        ...(params.slaDeadlineAt !== undefined ? { slaDeadlineAt: params.slaDeadlineAt } : {}),
        ...(params.assigneeUserId !== undefined ? { assigneeUserId: params.assigneeUserId } : {}),
        ...(params.responsibleLawyerUserId !== undefined
          ? { responsibleLawyerUserId: params.responsibleLawyerUserId }
          : {}),
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
        updatedAt: now,
      },
    })
}

/**
 * Marks a queue projection as resolved (terminal state).
 * Called when the source entity exits the queue (completed, dismissed, etc.).
 *
 * IDEMPOTENT: If the projection is already resolved, this is a no-op.
 */
export async function resolveQueueProjection(
  db: DbOrTx,
  params: {
    organizationId: string
    queueType: string
    entityType: string
    entityId: string
  }
): Promise<void> {
  const { queueProjections } = await import('@execflow/db/schema')

  await db
    .update(queueProjections)
    .set({ status: 'resolved', updatedAt: new Date() })
    .where(
      sql`
        organization_id = ${params.organizationId}::uuid
        AND queue_type = ${params.queueType}
        AND entity_type = ${params.entityType}
        AND entity_id = ${params.entityId}::uuid
        AND status != 'resolved'
      `
    )
}

/**
 * Updates blocking state on a queue projection.
 * Called when a blocking condition is detected or cleared.
 */
export async function setQueueProjectionBlocked(
  db: DbOrTx,
  params: {
    organizationId: string
    entityType: string
    entityId: string
    isBlocked: boolean
    blockingReason?: string
  }
): Promise<void> {
  const { queueProjections } = await import('@execflow/db/schema')

  await db
    .update(queueProjections)
    .set({
      isBlocked: params.isBlocked,
      blockingReason: params.isBlocked ? (params.blockingReason ?? null) : null,
      status: params.isBlocked ? 'blocked' : 'active',
      updatedAt: new Date(),
    })
    .where(
      sql`
        organization_id = ${params.organizationId}::uuid
        AND entity_type = ${params.entityType}
        AND entity_id = ${params.entityId}::uuid
        AND status != 'resolved'
      `
    )
}

/**
 * Updates staleness flag on a queue projection.
 * Called when underlying entity data changes materially (snapshot superseded, etc.).
 */
export async function setQueueProjectionStale(
  db: DbOrTx,
  params: {
    organizationId: string
    entityType: string
    entityId: string
    isStale: boolean
  }
): Promise<void> {
  const { queueProjections } = await import('@execflow/db/schema')

  await db
    .update(queueProjections)
    .set({ isStale: params.isStale, updatedAt: new Date() })
    .where(
      sql`
        organization_id = ${params.organizationId}::uuid
        AND entity_type = ${params.entityType}
        AND entity_id = ${params.entityId}::uuid
        AND status != 'resolved'
      `
    )
}

/**
 * Records SLA breach on a queue projection.
 * Called by the SLA sweep when sla_deadline_at passes without resolution.
 * IDEMPOTENT: sla_breached_at is set only if currently null.
 */
export async function markQueueProjectionSlaBreached(
  db: DbOrTx,
  projectionId: string,
  breachedAt: Date
): Promise<void> {
  const { queueProjections } = await import('@execflow/db/schema')

  await db
    .update(queueProjections)
    .set({ slaBreachedAt: breachedAt, updatedAt: new Date() })
    .where(
      sql`
        id = ${projectionId}::uuid
        AND sla_breached_at IS NULL
        AND status != 'resolved'
      `
    )
}

/**
 * Escalates a queue projection to the next level.
 * IDEMPOTENT: only escalates if current level < newLevel.
 */
export async function escalateQueueProjection(
  db: DbOrTx,
  params: {
    projectionId: string
    newLevel: number
    escalatedAt: Date
  }
): Promise<void> {
  const { queueProjections } = await import('@execflow/db/schema')

  await db
    .update(queueProjections)
    .set({
      escalationLevel: params.newLevel,
      lastEscalationAt: params.escalatedAt,
      updatedAt: new Date(),
    })
    .where(
      sql`
        id = ${params.projectionId}::uuid
        AND escalation_level < ${params.newLevel}
        AND status != 'resolved'
      `
    )
}
