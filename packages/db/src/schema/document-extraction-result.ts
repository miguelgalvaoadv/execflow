/**
 * Document extraction result — append-only structured data from one extraction run.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { documents } from './document.ts'
import { extractionRuns } from './extraction-run.ts'
import { confidenceLevelEnum } from './_enums-domain.ts'

export const documentExtractionResults = pgTable(
  'document_extraction_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    extractionRunId: uuid('extraction_run_id')
      .notNull()
      .references(() => extractionRuns.id),
    extractionType: text('extraction_type').notNull(),
    structuredData: jsonb('structured_data').notNull(),
    confidence: confidenceLevelEnum('confidence').notNull().default('medium'),
    providerMetadata: jsonb('provider_metadata').notNull().default({}),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('document_extraction_results_run_unique').on(table.extractionRunId),
    index('document_extraction_results_document_idx').on(table.documentId, table.extractedAt),
  ]
)

export type DocumentExtractionResult = typeof documentExtractionResults.$inferSelect
export type NewDocumentExtractionResult = typeof documentExtractionResults.$inferInsert
