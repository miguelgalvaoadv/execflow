/**
 * Snapshot promotion record — links confirmed extraction to proposed/confirmed snapshot.
 */

import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organization.ts'
import { documents } from './document.ts'
import { extractionRuns } from './extraction-run.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import { snapshotPromotionStatusEnum } from './_enums-snapshot-promotion.ts'

export const snapshotPromotions = pgTable(
  'snapshot_promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => documents.id),
    extractionRunId: uuid('extraction_run_id')
      .notNull()
      .references(() => extractionRuns.id),
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),
    snapshotKind: text('snapshot_kind').notNull(),
    snapshotId: uuid('snapshot_id'),
    status: snapshotPromotionStatusEnum('status').notNull().default('requested'),
    extractionType: text('extraction_type').notNull(),
    promotedByUserId: uuid('promoted_by_user_id').references(() => users.id),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    triggerEventId: uuid('trigger_event_id'),
    correlationId: uuid('correlation_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('snapshot_promotions_extraction_run_unique').on(table.extractionRunId),
    uniqueIndex('snapshot_promotions_trigger_idempotency_idx')
      .on(table.sourceDocumentId, table.triggerEventId)
      .where(sql`${table.triggerEventId} IS NOT NULL`),
    index('snapshot_promotions_status_idx').on(table.organizationId, table.status),
  ]
)

export type SnapshotPromotion = typeof snapshotPromotions.$inferSelect
export type NewSnapshotPromotion = typeof snapshotPromotions.$inferInsert
