/**
 * Review decision repository — append-only inserts.
 */

import { eq, and, desc } from 'drizzle-orm'
import { reviewDecisions } from '@execflow/db/schema'
import type { NewReviewDecisionRecord, ReviewDecisionRecord } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

export async function insertReviewDecision(
  tx: DbTransaction,
  row: NewReviewDecisionRecord
): Promise<RepositoryResult<ReviewDecisionRecord>> {
  try {
    const [inserted] = await tx.insert(reviewDecisions).values(row).returning()
    if (inserted === undefined) {
      return { success: false, error: { code: 'UNKNOWN', message: 'Insert returned no row.' } }
    }
    return { success: true, data: inserted }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert review decision.', cause: err },
    }
  }
}

export async function listReviewDecisionsForSubject(
  db: AnyTx,
  organizationId: string,
  subjectType: 'extraction' | 'snapshot',
  subjectId: string
): Promise<RepositoryResult<ReviewDecisionRecord[]>> {
  try {
    const rows = await db
      .select()
      .from(reviewDecisions)
      .where(
        and(
          eq(reviewDecisions.organizationId, organizationId),
          eq(reviewDecisions.subjectType, subjectType),
          eq(reviewDecisions.subjectId, subjectId)
        )
      )
      .orderBy(desc(reviewDecisions.reviewedAt))

    return { success: true, data: rows }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list review decisions.', cause: err },
    }
  }
}
