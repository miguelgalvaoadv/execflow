/**
 * Deadline repository — data access layer for the deadlines table.
 *
 * Deadlines are mutable: status, priority, due_at, assignee may all change.
 * Every mutable change that carries legal significance also appends a
 * DeadlineHistory row (done by the service layer in the same transaction).
 *
 * TERMINAL STATE GUARD: the repository does NOT enforce terminal state
 * transitions (completed/dismissed → anything forbidden). That guard lives
 * in the service layer where the full state machine is checked.
 * The repository is a pure data access layer.
 *
 * IMMUTABLE FIELDS: id, organization_id, execution_case_id, origin, created_at,
 * created_by_user_id. These fields are never included in update methods here.
 */

import { eq, and, asc, lt, gt, or, ilike, isNull, sql } from 'drizzle-orm'
import { deadlines, executionCases } from '@execflow/db/schema'
import type { Deadline, NewDeadline } from '@execflow/db/schema'
import type { DeadlineStatus, DeadlinePriority } from '@execflow/db/types'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams, PaginatedResult } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Find a deadline by primary key, scoped to the organization.
 */
export async function findDeadlineById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<Deadline>> {
  try {
    const row = await db.query.deadlines.findFirst({
      where: and(
        eq(deadlines.id, id),
        eq(deadlines.organizationId, organizationId)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Deadline not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query deadline.', cause: err },
    }
  }
}

/**
 * List deadlines for an execution case ordered by due date (soonest first).
 */
export async function listDeadlinesByCase(
  db: AnyTx,
  organizationId: string,
  executionCaseId: string,
  params: PaginationParams
): Promise<RepositoryResult<PaginatedResult<Deadline>>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)

    const rows = await db.query.deadlines.findMany({
      where: and(
        eq(deadlines.organizationId, organizationId),
        eq(deadlines.executionCaseId, executionCaseId),
        params.cursor !== undefined ? lt(deadlines.dueAt, new Date(params.cursor)) : undefined
      ),
      orderBy: [asc(deadlines.dueAt), asc(deadlines.id)],
      limit: limit + 1,
    })

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items[items.length - 1]
    const nextCursor =
      hasMore && last !== undefined ? last.dueAt.toISOString() : null

    return {
      success: true,
      data: { items, nextCursor, totalCount: items.length },
    }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list deadlines for case.', cause: err },
    }
  }
}

export type DeadlineOrgListItem = {
  id: string
  title: string
  deadlineClass: string
  status: string
  priority: string
  dueAt: Date
  executionCaseId: string
  caseInternalRef: string | null
}

export type ListDeadlinesForOrgFilters = {
  status?: string
  deadlineClass?: string
  priority?: string
  q?: string
}

function parseOrgListCursor(cursor: string): { id: string } | null {
  const separator = cursor.indexOf('|')
  const id = separator > 0 ? cursor.slice(separator + 1) : cursor
  if (id === '' || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return { id }
}

function encodeOrgListCursor(dueAt: Date, id: string): string {
  return `${dueAt.toISOString()}|${id}`
}

/**
 * Paginated org-scoped deadline list — dueAt ASC, id ASC (soonest first).
 */
export async function listDeadlinesForOrg(
  db: AnyTx,
  organizationId: string,
  filters: ListDeadlinesForOrgFilters,
  params: PaginationParams
): Promise<RepositoryResult<{ items: DeadlineOrgListItem[]; nextCursor: string | null }>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)
    const conditions = [eq(deadlines.organizationId, organizationId)]

    if (filters.status !== undefined) {
      conditions.push(eq(deadlines.status, filters.status as Deadline['status']))
    }

    if (filters.deadlineClass !== undefined) {
      conditions.push(eq(deadlines.deadlineClass, filters.deadlineClass as Deadline['deadlineClass']))
    }

    if (filters.priority !== undefined) {
      conditions.push(eq(deadlines.priority, filters.priority as Deadline['priority']))
    }

    const q = filters.q?.trim()
    if (q !== undefined && q.length > 0) {
      const pattern = `%${q}%`
      conditions.push(
        or(
          ilike(deadlines.title, pattern),
          ilike(deadlines.description, pattern),
          ilike(executionCases.internalRef, pattern)
        )!
      )
    }

    if (params.cursor !== undefined) {
      const parsed = parseOrgListCursor(params.cursor)
      if (parsed === null) {
        return {
          success: false,
          error: { code: 'CONSTRAINT', message: 'Invalid pagination cursor.' },
        }
      }
      conditions.push(
        sql`(${deadlines.dueAt}, ${deadlines.id}) > (
          SELECT due_at, id FROM deadlines
          WHERE id = ${parsed.id}::uuid AND organization_id = ${organizationId}
        )`
      )
    }

    const rows = await db
      .select({
        id: deadlines.id,
        title: deadlines.title,
        deadlineClass: deadlines.deadlineClass,
        status: deadlines.status,
        priority: deadlines.priority,
        dueAt: deadlines.dueAt,
        executionCaseId: deadlines.executionCaseId,
        caseInternalRef: executionCases.internalRef,
      })
      .from(deadlines)
      .innerJoin(
        executionCases,
        and(
          eq(deadlines.executionCaseId, executionCases.id),
          eq(executionCases.organizationId, organizationId),
          isNull(executionCases.deletedAt)
        )
      )
      .where(and(...conditions))
      .orderBy(asc(deadlines.dueAt), asc(deadlines.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const items: DeadlineOrgListItem[] = page.map((row: any) => ({
      id: row.id,
      title: row.title,
      deadlineClass: row.deadlineClass,
      status: row.status,
      priority: row.priority,
      dueAt: row.dueAt,
      executionCaseId: row.executionCaseId,
      caseInternalRef: row.caseInternalRef,
    }))

    const nextCursor =
      hasMore && page.length > 0
        ? encodeOrgListCursor(page[page.length - 1]!.dueAt, page[page.length - 1]!.id)
        : null

    return { success: true, data: { items, nextCursor } }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list deadlines for organization.', cause: err },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert a new deadline.
 * Must be called inside a transaction alongside AuditLog and DomainEvent writes.
 */
export async function insertDeadline(
  tx: DbTransaction,
  data: NewDeadline
): Promise<RepositoryResult<Deadline>> {
  try {
    const [row] = await tx.insert(deadlines).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Deadline insert returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert deadline.', cause: err },
    }
  }
}

/**
 * Transition a deadline's status.
 * The service layer enforces valid transitions BEFORE calling this.
 * This method writes the state change without validation.
 */
export async function updateDeadlineStatus(
  tx: DbTransaction,
  organizationId: string,
  deadlineId: string,
  params: {
    status: DeadlineStatus
    acknowledgedAt?: Date | undefined
    acknowledgedByUserId?: string | undefined
    completedAt?: Date | undefined
    completedByUserId?: string | undefined
    completionEvidenceType?: string | undefined
    completionEvidenceId?: string | undefined
    dismissedAt?: Date | undefined
    dismissedByUserId?: string | undefined
    dismissedReason?: string | undefined
    dismissedReasonCode?: string | undefined
    updatedAt: Date
  }
): Promise<RepositoryResult<Deadline>> {
  try {
    const [row] = await tx
      .update(deadlines)
      .set({
        status: params.status,
        ...(params.acknowledgedAt !== undefined ? { acknowledgedAt: params.acknowledgedAt } : {}),
        ...(params.acknowledgedByUserId !== undefined ? { acknowledgedByUserId: params.acknowledgedByUserId } : {}),
        ...(params.completedAt !== undefined ? { completedAt: params.completedAt } : {}),
        ...(params.completedByUserId !== undefined ? { completedByUserId: params.completedByUserId } : {}),
        ...(params.completionEvidenceType !== undefined ? { completionEvidenceType: params.completionEvidenceType } : {}),
        ...(params.completionEvidenceId !== undefined ? { completionEvidenceId: params.completionEvidenceId } : {}),
        ...(params.dismissedAt !== undefined ? { dismissedAt: params.dismissedAt } : {}),
        ...(params.dismissedByUserId !== undefined ? { dismissedByUserId: params.dismissedByUserId } : {}),
        ...(params.dismissedReason !== undefined ? { dismissedReason: params.dismissedReason } : {}),
        ...(params.dismissedReasonCode !== undefined ? { dismissedReasonCode: params.dismissedReasonCode } : {}),
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(deadlines.id, deadlineId),
          eq(deadlines.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Deadline not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update deadline status.', cause: err },
    }
  }
}

/**
 * Update queue compatibility flags (blocked, stale).
 * Called by the queue engine (Phase 6+). May also be called by services
 * when a blocking condition is detected during an operation.
 */
export async function updateDeadlineFlags(
  tx: DbTransaction,
  organizationId: string,
  deadlineId: string,
  params: {
    isBlocked?: boolean | undefined
    blockingReason?: string | null | undefined
    isStale?: boolean | undefined
    escalationLevel?: number | undefined
    escalatedAt?: Date | null | undefined
    lastCheckedAt?: Date | undefined
    updatedAt: Date
  }
): Promise<RepositoryResult<Deadline>> {
  try {
    const [row] = await tx
      .update(deadlines)
      .set({
        ...(params.isBlocked !== undefined ? { isBlocked: params.isBlocked } : {}),
        ...(params.blockingReason !== undefined ? { blockingReason: params.blockingReason } : {}),
        ...(params.isStale !== undefined ? { isStale: params.isStale } : {}),
        ...(params.escalationLevel !== undefined ? { escalationLevel: params.escalationLevel } : {}),
        ...(params.escalatedAt !== undefined ? { escalatedAt: params.escalatedAt } : {}),
        ...(params.lastCheckedAt !== undefined ? { lastCheckedAt: params.lastCheckedAt } : {}),
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(deadlines.id, deadlineId),
          eq(deadlines.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Deadline not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update deadline flags.', cause: err },
    }
  }
}
