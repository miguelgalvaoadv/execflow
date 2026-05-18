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

import { eq, and, isNull } from 'drizzle-orm'
import { deadlines } from '@execflow/db/schema'
import type { Deadline, NewDeadline } from '@execflow/db/schema'
import type { DeadlineStatus, DeadlinePriority } from '@execflow/db/types'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

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
