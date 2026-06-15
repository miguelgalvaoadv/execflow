/**
 * SentenceSnapshot repository — append-only inserts; lifecycle fields updated only
 * for confirmation/supersede (operational status, not arithmetic mutation).
 */

import { eq, and, desc, sql } from 'drizzle-orm'
import { sentenceSnapshots } from '@execflow/db/schema'
import type { SentenceSnapshot, NewSentenceSnapshot } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams, PaginatedResult } from '@execflow/db/repositories'

export async function findSentenceSnapshotById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<SentenceSnapshot>> {
  try {
    const row = await db.query.sentenceSnapshots.findFirst({
      where: and(
        eq(sentenceSnapshots.id, id),
        eq(sentenceSnapshots.organizationId, organizationId)
      ),
    })
    if (row === undefined) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Sentence snapshot not found.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query sentence snapshot.', cause: err },
    }
  }
}

export async function insertSentenceSnapshot(
  tx: DbTransaction,
  row: NewSentenceSnapshot
): Promise<RepositoryResult<SentenceSnapshot>> {
  try {
    const [inserted] = await tx.insert(sentenceSnapshots).values(row).returning()
    if (inserted === undefined) {
      return { success: false, error: { code: 'UNKNOWN', message: 'Insert returned no row.' } }
    }
    return { success: true, data: inserted }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert sentence snapshot.', cause: err },
    }
  }
}

/** Confirmation — only status and confirmation attribution (not arithmetic). */
export async function confirmSentenceSnapshotRow(
  tx: DbTransaction,
  organizationId: string,
  snapshotId: string,
  params: { confirmedByUserId: string; confirmedAt: Date }
): Promise<RepositoryResult<SentenceSnapshot>> {
  try {
    const [row] = await tx
      .update(sentenceSnapshots)
      .set({
        status: 'confirmed',
        confirmedByUserId: params.confirmedByUserId,
        confirmedAt: params.confirmedAt,
      })
      .where(
        and(
          eq(sentenceSnapshots.id, snapshotId),
          eq(sentenceSnapshots.organizationId, organizationId),
          eq(sentenceSnapshots.status, 'proposed')
        )
      )
      .returning()

    if (row === undefined) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Sentence snapshot not found or not in proposed status.',
        },
      }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to confirm sentence snapshot.', cause: err },
    }
  }
}

/** Supersede — marks prior confirmed snapshot; arithmetic rows remain immutable. */
export async function markSentenceSnapshotSuperseded(
  tx: DbTransaction,
  organizationId: string,
  snapshotId: string
): Promise<RepositoryResult<SentenceSnapshot>> {
  try {
    const [row] = await tx
      .update(sentenceSnapshots)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(sentenceSnapshots.id, snapshotId),
          eq(sentenceSnapshots.organizationId, organizationId),
          eq(sentenceSnapshots.status, 'confirmed')
        )
      )
      .returning()

    if (row === undefined) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Sentence snapshot not found or not in confirmed status.',
        },
      }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to supersede sentence snapshot.', cause: err },
    }
  }
}

export async function listSentenceSnapshotsByCase(
  db: AnyTx,
  organizationId: string,
  executionCaseId: string,
  params: PaginationParams
): Promise<RepositoryResult<PaginatedResult<SentenceSnapshot>>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)
    const conditions = [
      eq(sentenceSnapshots.organizationId, organizationId),
      eq(sentenceSnapshots.executionCaseId, executionCaseId),
    ]

    if (params.cursor !== undefined) {
      const [cursorEffectiveAt, cursorId] = params.cursor.split('|')
      if (cursorEffectiveAt !== undefined && cursorId !== undefined) {
        conditions.push(
          sql`(${sentenceSnapshots.effectiveAt}, ${sentenceSnapshots.id}) < (${cursorEffectiveAt}::timestamptz, ${cursorId}::uuid)`
        )
      }
    }

    const rows = await db
      .select()
      .from(sentenceSnapshots)
      .where(and(...conditions))
      .orderBy(desc(sentenceSnapshots.effectiveAt), desc(sentenceSnapshots.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items[items.length - 1]
    const nextCursor =
      hasMore && last !== undefined
        ? `${last.effectiveAt.toISOString()}|${last.id}`
        : null

    return {
      success: true,
      data: { items, nextCursor, totalCount: items.length },
    }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list sentence snapshots for case.', cause: err },
    }
  }
}
