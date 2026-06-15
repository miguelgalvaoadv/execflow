/**
 * Snapshot promotion enums.
 */

import { pgEnum } from 'drizzle-orm/pg-core'

export const snapshotPromotionStatusEnum = pgEnum('snapshot_promotion_status', [
  'requested',
  'proposed',
  'confirmed',
  'skipped',
  'failed',
])

export type SnapshotPromotionStatus =
  (typeof snapshotPromotionStatusEnum.enumValues)[number]
