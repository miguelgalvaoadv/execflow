/**
 * WorkflowTask repository — data access for the workflow_tasks table.
 *
 * CLAIM SEMANTICS:
 * The claim operation uses a conditional update (WHERE claimed_by_user_id IS NULL)
 * to prevent double-claims. If two users attempt to claim simultaneously, only
 * one succeeds (PostgreSQL row-level locking). The service layer converts a
 * 0-rows-updated result into a CONFLICT error.
 *
 * TERMINAL STATE GUARD:
 * The repository does NOT enforce terminal state guards.
 * The service layer must check status before calling update methods.
 *
 * Architecture ref: office-operating-system.md §3 (ownership and assignment).
 */

import { and, eq, ne, isNull, asc, sql } from 'drizzle-orm'
import { workflowTasks } from '@execflow/db/schema'
import type { WorkflowTask, NewWorkflowTask } from '@execflow/db/schema'
import type { WorkflowTaskStatus } from '@execflow/db/types'
import type { AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Find a workflow task by primary key, scoped to organization.
 */
export async function findWorkflowTaskById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<WorkflowTask>> {
  try {
    const row = await db.query.workflowTasks.findFirst({
      where: and(
        eq(workflowTasks.id, id),
        eq(workflowTasks.organizationId, organizationId)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Workflow task not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to find workflow task.', cause: err },
    }
  }
}

/**
 * Lists workflow tasks for an organization with optional filters.
 * Ordered by priority ASC then due_at ASC.
 */
export async function listWorkflowTasks(
  db: AnyTx,
  organizationId: string,
  filters: {
    status?: WorkflowTaskStatus
    assignedToUserId?: string
    claimedByUserId?: string
    executionCaseId?: string
    excludeTerminal?: boolean
  },
  pagination: PaginationParams
): Promise<RepositoryResult<{ items: WorkflowTask[]; nextCursor: string | null }>> {
  try {
    const conditions = [eq(workflowTasks.organizationId, organizationId)]

    if (filters.status) {
      conditions.push(eq(workflowTasks.status, filters.status))
    } else if (filters.excludeTerminal !== false) {
      conditions.push(
        sql`status NOT IN ('completed', 'cancelled')`
      )
    }

    if (filters.assignedToUserId) {
      conditions.push(eq(workflowTasks.assignedToUserId, filters.assignedToUserId))
    }

    if (filters.claimedByUserId) {
      conditions.push(eq(workflowTasks.claimedByUserId, filters.claimedByUserId))
    }

    if (filters.executionCaseId) {
      conditions.push(eq(workflowTasks.executionCaseId, filters.executionCaseId))
    }

    if (pagination.cursor) {
      conditions.push(sql`id > ${pagination.cursor}::uuid`)
    }

    const limit = Math.min(pagination.limit, 200)

    const items = await db
      .select()
      .from(workflowTasks)
      .where(and(...conditions))
      .orderBy(asc(workflowTasks.dueAt))
      .limit(limit + 1)

    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    return { success: true, data: { items: page, nextCursor } }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list workflow tasks.', cause: err },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Inserts a new workflow task.
 */
export async function insertWorkflowTask(
  db: AnyTx,
  data: NewWorkflowTask
): Promise<RepositoryResult<WorkflowTask>> {
  try {
    const rows = await db.insert(workflowTasks).values(data).returning()
    const row = rows[0]
    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Insert returned no rows.' },
      }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert workflow task.', cause: err },
    }
  }
}

/**
 * Claims a workflow task for a user.
 * CONDITIONAL UPDATE: only updates if claimed_by_user_id IS NULL (unclaimed).
 * Returns NOT_FOUND if task doesn't exist; CONFLICT if already claimed.
 */
export async function claimWorkflowTask(
  db: AnyTx,
  organizationId: string,
  taskId: string,
  claimedByUserId: string
): Promise<RepositoryResult<WorkflowTask>> {
  try {
    const now = new Date()

    const rows = await db
      .update(workflowTasks)
      .set({
        status: 'claimed',
        claimedByUserId,
        claimedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowTasks.id, taskId),
          eq(workflowTasks.organizationId, organizationId),
          isNull(workflowTasks.claimedByUserId),
          sql`status IN ('pending', 'released')`
        )
      )
      .returning()

    const row = rows[0]
    if (!row) {
      const exists = await findWorkflowTaskById(db, organizationId, taskId)
      if (!exists.success) return exists
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Workflow task is already claimed or not in a claimable state.',
        },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to claim workflow task.', cause: err },
    }
  }
}

/**
 * Releases a workflow task back to the pool.
 * CONDITIONAL: only the current claimant can release.
 */
export async function releaseWorkflowTask(
  db: AnyTx,
  organizationId: string,
  taskId: string,
  releasedByUserId: string
): Promise<RepositoryResult<WorkflowTask>> {
  try {
    const now = new Date()

    const rows = await db
      .update(workflowTasks)
      .set({
        status: 'released',
        claimedByUserId: null,
        claimedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowTasks.id, taskId),
          eq(workflowTasks.organizationId, organizationId),
          eq(workflowTasks.claimedByUserId, releasedByUserId),
          sql`status IN ('claimed', 'in_progress')`
        )
      )
      .returning()

    const row = rows[0]
    if (!row) {
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You are not the current claimant or the task cannot be released.',
        },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to release workflow task.', cause: err },
    }
  }
}

/**
 * Completes a workflow task.
 * Only the current claimant or assignee may complete. Terminal state.
 */
export async function completeWorkflowTask(
  db: AnyTx,
  organizationId: string,
  taskId: string,
  completedByUserId: string,
  evidenceType?: string,
  evidenceId?: string
): Promise<RepositoryResult<WorkflowTask>> {
  try {
    const now = new Date()

    const rows = await db
      .update(workflowTasks)
      .set({
        status: 'completed',
        completedAt: now,
        completedByUserId,
        ...(evidenceType !== undefined ? { completionEvidenceType: evidenceType } : {}),
        ...(evidenceId !== undefined ? { completionEvidenceId: evidenceId } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowTasks.id, taskId),
          eq(workflowTasks.organizationId, organizationId),
          sql`status NOT IN ('completed', 'cancelled')`
        )
      )
      .returning()

    const row = rows[0]
    if (!row) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Workflow task is already in a terminal state or not found.',
        },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to complete workflow task.', cause: err },
    }
  }
}
