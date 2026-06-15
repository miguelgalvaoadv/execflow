/**
 * CustodySnapshot repository — append-only inserts; confirmation/supersede update
 * only operational lifecycle columns (confirmed_*, superseded_*).
 */

import { eq, and, isNull } from 'drizzle-orm'
import { custodySnapshots } from '@execflow/db/schema'
import type { CustodySnapshot, NewCustodySnapshot } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

export async function findCustodySnapshotById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<CustodySnapshot>> {
  try {
    const row = await db.query.custodySnapshots.findFirst({
      where: and(
        eq(custodySnapshots.id, id),
        eq(custodySnapshots.organizationId, organizationId)
      ),
    })
    if (row === undefined) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Custody snapshot not found.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query custody snapshot.', cause: err },
    }
  }
}

export async function insertCustodySnapshot(
  tx: DbTransaction,
  row: NewCustodySnapshot
): Promise<RepositoryResult<CustodySnapshot>> {
  try {
    const [inserted] = await tx.insert(custodySnapshots).values(row).returning()
    if (inserted === undefined) {
      return { success: false, error: { code: 'UNKNOWN', message: 'Insert returned no row.' } }
    }
    return { success: true, data: inserted }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert custody snapshot.', cause: err },
    }
  }
}

export async function confirmCustodySnapshotRow(
  tx: DbTransaction,
  organizationId: string,
  snapshotId: string,
  params: { confirmedByUserId: string; confirmedAt: Date }
): Promise<RepositoryResult<CustodySnapshot>> {
  try {
    const [row] = await tx
      .update(custodySnapshots)
      .set({
        confirmedByUserId: params.confirmedByUserId,
        confirmedAt: params.confirmedAt,
      })
      .where(
        and(
          eq(custodySnapshots.id, snapshotId),
          eq(custodySnapshots.organizationId, organizationId),
          isNull(custodySnapshots.confirmedByUserId),
          isNull(custodySnapshots.supersededAt)
        )
      )
      .returning()

    if (row === undefined) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Custody snapshot not found or already confirmed/superseded.',
        },
      }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to confirm custody snapshot.', cause: err },
    }
  }
}

export async function markCustodySnapshotSuperseded(
  tx: DbTransaction,
  organizationId: string,
  snapshotId: string,
  params: { supersededAt: Date; supersededBySnapshotId: string }
): Promise<RepositoryResult<CustodySnapshot>> {
  try {
    const [row] = await tx
      .update(custodySnapshots)
      .set({
        supersededAt: params.supersededAt,
        supersededBySnapshotId: params.supersededBySnapshotId,
      })
      .where(
        and(
          eq(custodySnapshots.id, snapshotId),
          eq(custodySnapshots.organizationId, organizationId),
          isNull(custodySnapshots.supersededAt)
        )
      )
      .returning()

    if (row === undefined) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Custody snapshot not found or already superseded.',
        },
      }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to supersede custody snapshot.', cause: err },
    }
  }
}
