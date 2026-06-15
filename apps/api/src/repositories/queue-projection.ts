/**
 * Queue projection repository — read operations for the queue_projections table.
 *
 * QUEUE PROJECTIONS ARE WRITE-ONLY FROM THE API PERSPECTIVE:
 * The API does NOT write to queue_projections directly. All writes go through
 * the workers package (via event consumers and SLA sweeps).
 *
 * The API only reads from queue_projections for the "list queue projections"
 * endpoint and related queue views.
 *
 * EXCEPTIONS:
 * - Snooze / defer: the API writes snooze_until / deferred_until and changes
 *   status from 'active' to 'snoozed' / 'deferred'. These are UI-driven
 *   operations that don't go through the event system.
 * - Claim / release: WorkflowTask claim/release updates the queue_projections
 *   assignee field in addition to the workflow_tasks table.
 *
 * Architecture ref: office-operating-system.md §2 (queue architecture).
 */

import { and, eq, ne, lt, isNotNull, asc, isNull, sql } from 'drizzle-orm'
import { queueProjections } from '@execflow/db/schema'
import type { QueueProjection } from '@execflow/db/schema'
import type { AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

export type ListQueueProjectionsFilters = {
  queueType?: string
  assigneeUserId?: string
  responsibleLawyerUserId?: string
  executionCaseId?: string
  status?: string
  priority?: number
  excludeResolved?: boolean
}

/**
 * Lists queue projections for an organization, with optional filters.
 * Ordered by priority ASC (0 = most urgent) then key_date ASC.
 *
 * All list operations are paginated — no unbounded queries.
 */
export async function listQueueProjections(
  db: AnyTx,
  organizationId: string,
  filters: ListQueueProjectionsFilters,
  pagination: PaginationParams
): Promise<RepositoryResult<{ items: QueueProjection[]; nextCursor: string | null }>> {
  try {
    const conditions = [eq(queueProjections.organizationId, organizationId)]

    if (filters.queueType) {
      conditions.push(
        eq(
          queueProjections.queueType,
          filters.queueType as typeof queueProjections.$inferSelect['queueType']
        )
      )
    }

    if (filters.assigneeUserId) {
      conditions.push(eq(queueProjections.assigneeUserId, filters.assigneeUserId))
    }

    if (filters.responsibleLawyerUserId) {
      conditions.push(eq(queueProjections.responsibleLawyerUserId, filters.responsibleLawyerUserId))
    }

    if (filters.executionCaseId) {
      conditions.push(eq(queueProjections.executionCaseId, filters.executionCaseId))
    }

    if (filters.status) {
      conditions.push(
        eq(
          queueProjections.status,
          filters.status as typeof queueProjections.$inferSelect['status']
        )
      )
    } else if (filters.excludeResolved !== false) {
      conditions.push(ne(queueProjections.status, 'resolved'))
    }

    if (filters.priority !== undefined) {
      conditions.push(eq(queueProjections.priority, filters.priority))
    }

    if (pagination.cursor) {
      conditions.push(sql`id > ${pagination.cursor}::uuid`)
    }

    const limit = Math.min(pagination.limit, 200)

    const items = await db
      .select()
      .from(queueProjections)
      .where(and(...conditions))
      .orderBy(asc(queueProjections.priority), asc(queueProjections.keyDate))
      .limit(limit + 1)

    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    return { success: true, data: { items: page, nextCursor } }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list queue projections.', cause: err },
    }
  }
}

/**
 * Find a single queue projection by ID, scoped to organization.
 */
export async function findQueueProjectionById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<QueueProjection>> {
  try {
    const row = await db.query.queueProjections.findFirst({
      where: and(
        eq(queueProjections.id, id),
        eq(queueProjections.organizationId, organizationId)
      ),
    })

    if (!row) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Queue projection not found.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to find queue projection.', cause: err },
    }
  }
}

/**
 * Updates snooze state on a queue projection.
 * Called by the snooze API endpoint (user-driven action).
 */
export async function snoozeQueueProjection(
  db: AnyTx,
  organizationId: string,
  id: string,
  snoozeUntil: Date,
  snoozedByUserId: string
): Promise<RepositoryResult<QueueProjection>> {
  try {
    const rows = await db
      .update(queueProjections)
      .set({
        status: 'snoozed',
        snoozeUntil,
        snoozedByUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(queueProjections.id, id),
          eq(queueProjections.organizationId, organizationId),
          ne(queueProjections.status, 'resolved')
        )
      )
      .returning()

    const row = rows[0]
    if (!row) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Queue projection not found or already resolved.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to snooze queue projection.', cause: err },
    }
  }
}

/** Resolves a queue projection when review completes (confirm/reject). */
export async function resolveQueueProjection(
  db: AnyTx,
  params: {
    organizationId: string
    queueType: string
    entityType: string
    entityId: string
  }
): Promise<void> {
  await db
    .update(queueProjections)
    .set({ status: 'resolved', updatedAt: new Date() })
    .where(
      and(
        eq(queueProjections.organizationId, params.organizationId),
        eq(
          queueProjections.queueType,
          params.queueType as typeof queueProjections.$inferSelect['queueType']
        ),
        eq(queueProjections.entityType, params.entityType),
        eq(queueProjections.entityId, params.entityId),
        ne(queueProjections.status, 'resolved')
      )
    )
}
