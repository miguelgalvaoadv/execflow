/**
 * OpportunityStatusHistory repository — append-only.
 *
 * APPEND-ONLY CONTRACT: expose only `appendOpportunityStatusHistory()`.
 */

import { opportunityStatusHistory } from '@execflow/db/schema'
import type { OpportunityStatusHistoryRecord, NewOpportunityStatusHistoryRecord } from '@execflow/db/schema'
import type { DbTransaction } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

/**
 * Append an immutable status transition record.
 * Must be called inside the same transaction as the opportunity status update.
 */
export async function appendOpportunityStatusHistory(
  tx: DbTransaction,
  data: NewOpportunityStatusHistoryRecord
): Promise<RepositoryResult<OpportunityStatusHistoryRecord>> {
  try {
    const [row] = await tx.insert(opportunityStatusHistory).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Status history append returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to append opportunity status history.', cause: err },
    }
  }
}
