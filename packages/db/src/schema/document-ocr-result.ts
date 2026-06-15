/**
 * Document OCR result — append-only raw text from one OCR run.
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { documents } from './document.ts'
import { ocrRuns } from './ocr-run.ts'

export const documentOcrResults = pgTable(
  'document_ocr_results',
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
    providerId: text('provider_id').notNull(),
    rawText: text('raw_text').notNull(),
    pageCount: integer('page_count').notNull().default(1),
    providerMetadata: jsonb('provider_metadata').notNull().default({}),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('document_ocr_results_run_unique').on(table.ocrRunId),
    index('document_ocr_results_document_idx').on(table.documentId, table.extractedAt),
  ]
)

export type DocumentOcrResult = typeof documentOcrResults.$inferSelect
export type NewDocumentOcrResult = typeof documentOcrResults.$inferInsert
