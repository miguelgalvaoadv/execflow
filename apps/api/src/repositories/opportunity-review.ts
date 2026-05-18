/**
 * OpportunityReview repository — append-only.
 *
 * APPEND-ONLY CONTRACT: expose only `appendOpportunityReview()`.
 * No update, no delete methods exist here.
 */

import { eq, asc } from 'drizzle-orm'
import { opportunityReviews } from '@execflow/db/schema'
import type { OpportunityReview, NewOpportunityReview } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

/**
 * Append an immutable opportunity review record.
 * Must be called inside the same transaction as the opportunity status update.
 */
export async function appendOpportunityReview(
  tx: DbTransaction,
  data: NewOpportunityReview
): Promise<RepositoryResult<OpportunityReview>> {
  try {
    const [row] = await tx.insert(opportunityReviews).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Opportunity review append returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to append opportunity review.', cause: err },
    }
  }
}

/**
 * Query the full review history for an opportunity, chronological.
 */
export async function queryOpportunityReviews(
  db: AnyTx,
  opportunityId: string
): Promise<RepositoryResult<OpportunityReview[]>> {
  try {
    const rows = await db.query.opportunityReviews.findMany({
      where: eq(opportunityReviews.opportunityId, opportunityId),
      orderBy: [asc(opportunityReviews.reviewedAt)],
    })

    return { success: true, data: rows }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query opportunity reviews.', cause: err },
    }
  }
}
