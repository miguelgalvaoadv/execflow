/**
 * Runtime validation for snapshot promotion records and mapped payloads.
 */

import type { SnapshotKind } from '../types/snapshot-promotion-events.ts'

const SNAPSHOT_KINDS: SnapshotKind[] = ['sentence', 'custody']

export function assertSnapshotKind(value: unknown, context: string): asserts value is SnapshotKind {
  if (typeof value !== 'string' || !(SNAPSHOT_KINDS as readonly string[]).includes(value)) {
    throw new Error(
      `[execflow/db] snapshot promotion snapshot_kind must be sentence or custody at ${context}, received ${String(value)}`
    )
  }
}

export function assertSnapshotPromotionRow(
  row: { snapshotKind: unknown; status: unknown },
  context: string
): void {
  assertSnapshotKind(row.snapshotKind, context)
  if (typeof row.status !== 'string') {
    throw new Error(
      `[execflow/db] snapshot_promotions.status must be string at ${context}, received ${typeof row.status}`
    )
  }
}
