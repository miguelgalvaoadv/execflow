/**
 * OCR run lifecycle — tracks requested → running → completed | failed.
 */

import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organization.ts'
import { documents } from './document.ts'
import { ocrRunStatusEnum } from './_enums-ocr.ts'

export const ocrRuns = pgTable(
  'ocr_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    runNumber: integer('run_number').notNull(),
    status: ocrRunStatusEnum('status').notNull().default('requested'),
    providerId: text('provider_id').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    errorMessage: text('error_message'),
    triggerEventId: uuid('trigger_event_id'),
    correlationId: uuid('correlation_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ocr_runs_document_run_number_unique').on(table.documentId, table.runNumber),
    uniqueIndex('ocr_runs_trigger_idempotency_idx')
      .on(table.documentId, table.triggerEventId)
      .where(sql`${table.triggerEventId} IS NOT NULL`),
    index('ocr_runs_status_queue_idx').on(table.organizationId, table.status),
  ]
)

export type OcrRun = typeof ocrRuns.$inferSelect
export type NewOcrRun = typeof ocrRuns.$inferInsert
