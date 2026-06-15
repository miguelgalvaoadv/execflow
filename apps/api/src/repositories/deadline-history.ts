/**
 * DeadlineHistory repository — append-only write interface.
 *
 * APPEND-ONLY CONTRACT: expose only `appendDeadlineHistory()`.
 * No update, no delete, no soft-delete.
 *
 * Called by the deadline service whenever a material change is made to a deadline.
 * The service is responsible for determining what changed and constructing the
 * previousValue / newValue diff; this repository only persists it.
 */

import { eq, and, asc } from 'drizzle-orm'
import { deadlineHistory } from '@execflow/db/schema'
import type { DeadlineHistoryRecord, NewDeadlineHistoryRecord } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'
import { assertDeadlineHistoryActorAttribution } from '@execflow/db/types'

/**
 * Append a deadline change record.
 * Must be called inside the same transaction as the deadline update.
 */
export async function appendDeadlineHistory(
  tx: DbTransaction,
  data: NewDeadlineHistoryRecord
): Promise<RepositoryResult<DeadlineHistoryRecord>> {
  try {
    assertDeadlineHistoryActorAttribution(data)

    const [row] = await tx.insert(deadlineHistory).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Deadline history append returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to append deadline history.', cause: err },
    }
  }
}

/**
 * Query the full change history for a deadline, oldest first.
 * Used for the deadline detail view and legal defensibility audit.
 */
export async function queryDeadlineHistory(
  db: AnyTx,
  organizationId: string,
  deadlineId: string
): Promise<RepositoryResult<DeadlineHistoryRecord[]>> {
  try {
    const rows = await db.query.deadlineHistory.findMany({
      where: and(
        eq(deadlineHistory.organizationId, organizationId),
        eq(deadlineHistory.deadlineId, deadlineId)
      ),
      orderBy: [asc(deadlineHistory.changedAt)],
    })

    return { success: true, data: rows }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query deadline history.', cause: err },
    }
  }
}
