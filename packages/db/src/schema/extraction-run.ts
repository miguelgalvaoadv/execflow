/**
 * Extraction run lifecycle — OCR text → structured fields → human review → confirmed.
 */

import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organization.ts'
import { documents } from './document.ts'
import { ocrRuns } from './ocr-run.ts'
import { documentOcrResults } from './document-ocr-result.ts'
import { users } from './user.ts'
import { extractionRunStatusEnum } from './_enums-extraction.ts'

export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    ocrRunId: uuid('ocr_run_id')
      .notNull()
      .references(() => ocrRuns.id),
    ocrResultId: uuid('ocr_result_id')
      .notNull()
      .references(() => documentOcrResults.id),
    runNumber: integer('run_number').notNull(),
    status: extractionRunStatusEnum('status').notNull().default('requested'),
    extractionType: text('extraction_type').notNull().default('generic'),
    providerId: text('provider_id').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    errorMessage: text('error_message'),
    triggerEventId: uuid('trigger_event_id'),
    correlationId: uuid('correlation_id'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('extraction_runs_document_run_number_unique').on(
      table.documentId,
      table.runNumber
    ),
    uniqueIndex('extraction_runs_trigger_idempotency_idx')
      .on(table.documentId, table.triggerEventId)
      .where(sql`${table.triggerEventId} IS NOT NULL`),
    index('extraction_runs_status_queue_idx').on(table.organizationId, table.status),
  ]
)

export type ExtractionRun = typeof extractionRuns.$inferSelect
export type NewExtractionRun = typeof extractionRuns.$inferInsert
