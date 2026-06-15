/**
 * Opportunity repository — data access layer for the opportunities table.
 *
 * State machine enforcement is in the service layer, not here.
 * This repository is a pure data access layer.
 *
 * IMMUTABLE FIELDS: id, organization_id, execution_case_id, opportunity_type,
 *   detected_at, created_at, created_by_user_id. Never included in update methods.
 */

import { eq, and, desc, lt } from 'drizzle-orm'
import { opportunities } from '@execflow/db/schema'
import type { Opportunity, NewOpportunity } from '@execflow/db/schema'
import type { OpportunityStatus } from '@execflow/db/types'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams, PaginatedResult } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Find an opportunity by primary key, scoped to the organization.
 */
export async function findOpportunityById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<Opportunity>> {
  try {
    const row = await db.query.opportunities.findFirst({
      where: and(
        eq(opportunities.id, id),
        eq(opportunities.organizationId, organizationId)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Opportunity not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query opportunity.', cause: err },
    }
  }
}

/**
 * List opportunities for an execution case, most recently detected first.
 */
export async function listOpportunitiesByCase(
  db: AnyTx,
  organizationId: string,
  executionCaseId: string,
  params: PaginationParams
): Promise<RepositoryResult<PaginatedResult<Opportunity>>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)

    const rows = await db.query.opportunities.findMany({
      where: and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.executionCaseId, executionCaseId),
        params.cursor !== undefined ? lt(opportunities.detectedAt, new Date(params.cursor)) : undefined
      ),
      orderBy: [desc(opportunities.detectedAt), desc(opportunities.id)],
      limit: limit + 1,
    })

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items[items.length - 1]
    const nextCursor =
      hasMore && last !== undefined ? last.detectedAt.toISOString() : null

    return {
      success: true,
      data: { items, nextCursor, totalCount: items.length },
    }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list opportunities for case.', cause: err },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert a new opportunity.
 * Must be called inside a transaction.
 */
export async function insertOpportunity(
  tx: DbTransaction,
  data: NewOpportunity
): Promise<RepositoryResult<Opportunity>> {
  try {
    const [row] = await tx.insert(opportunities).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Opportunity insert returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert opportunity.', cause: err },
    }
  }
}

/**
 * Transition an opportunity's status.
 * Also updates qualification/dismissal/expiry timestamps and related fields.
 * The service layer enforces valid transitions before calling this.
 */
export async function updateOpportunityStatus(
  tx: DbTransaction,
  organizationId: string,
  opportunityId: string,
  params: {
    status: OpportunityStatus
    qualifiedAt?: Date | undefined
    qualifiedByUserId?: string | undefined
    dismissedAt?: Date | undefined
    dismissedByUserId?: string | undefined
    dismissedReason?: string | undefined
    expiredAt?: Date | undefined
    realizedPieceDraftId?: string | undefined
    isPendingReview?: boolean | undefined
    updatedAt: Date
  }
): Promise<RepositoryResult<Opportunity>> {
  try {
    const [row] = await tx
      .update(opportunities)
      .set({
        status: params.status,
        ...(params.qualifiedAt !== undefined ? { qualifiedAt: params.qualifiedAt } : {}),
        ...(params.qualifiedByUserId !== undefined ? { qualifiedByUserId: params.qualifiedByUserId } : {}),
        ...(params.dismissedAt !== undefined ? { dismissedAt: params.dismissedAt } : {}),
        ...(params.dismissedByUserId !== undefined ? { dismissedByUserId: params.dismissedByUserId } : {}),
        ...(params.dismissedReason !== undefined ? { dismissedReason: params.dismissedReason } : {}),
        ...(params.expiredAt !== undefined ? { expiredAt: params.expiredAt } : {}),
        ...(params.realizedPieceDraftId !== undefined ? { realizedPieceDraftId: params.realizedPieceDraftId } : {}),
        ...(params.isPendingReview !== undefined ? { isPendingReview: params.isPendingReview } : {}),
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Opportunity not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update opportunity status.', cause: err },
    }
  }
}

/**
 * Update queue compatibility flags (pending review, blocked, stale).
 * Called by services and engine integration points.
 */
export async function updateOpportunityFlags(
  tx: DbTransaction,
  organizationId: string,
  opportunityId: string,
  params: {
    requiresReview?: boolean | undefined
    isPendingReview?: boolean | undefined
    isBlocked?: boolean | undefined
    isStale?: boolean | undefined
    blockingConditions?: unknown
    updatedAt: Date
  }
): Promise<RepositoryResult<Opportunity>> {
  try {
    const [row] = await tx
      .update(opportunities)
      .set({
        ...(params.requiresReview !== undefined ? { requiresReview: params.requiresReview } : {}),
        ...(params.isPendingReview !== undefined ? { isPendingReview: params.isPendingReview } : {}),
        ...(params.isBlocked !== undefined ? { isBlocked: params.isBlocked } : {}),
        ...(params.isStale !== undefined ? { isStale: params.isStale } : {}),
        ...(params.blockingConditions !== undefined ? { blockingConditions: params.blockingConditions } : {}),
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Opportunity not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update opportunity flags.', cause: err },
    }
  }
}
