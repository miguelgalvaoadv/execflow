/**
 * astrea_email_logs
 *
 * Every e-mail read from the dedicated Astrea ingestion mailbox produces exactly
 * one row here — success, orphan (CNJ extracted but no matching ExecutionCase),
 * parse failure, duplicate, or administrative (no CNJ, not a movement notice).
 *
 * ANTI-DATA-LOSS CONTRACT: nothing read from the mailbox is ever discarded
 * silently. A row always exists, and rawBodySnapshot is kept even on success
 * so the email format can be inspected later if Astrea changes its template.
 *
 * One e-mail may describe movements for several processes (the Astrea
 * notification covers "all public office processes"), so one row here can
 * correspond to multiple timelineEvents — see timelineEventsCreated.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'

export const astreaEmailStatusEnum = pgEnum('astrea_email_status', [
  'processed', // CNJ extracted, case matched, timelineEvent(s) recorded
  'orphan', // CNJ extracted, no matching ExecutionCase — needs manual triage
  'parse_failed', // neither regex nor Claude could extract a usable CNJ
  'duplicate', // already processed before (same messageId / contentHash)
  'ignored_no_cnj', // Astrea administrative e-mail, not a movement notice
])

export const astreaExtractionMethodEnum = pgEnum('astrea_extraction_method', [
  'regex',
  'claude_haiku',
  'failed',
])

export const astreaEmailLogs = pgTable(
  'astrea_email_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    // Identity of the source e-mail — idempotency keys.
    messageId: text('message_id'), // header Message-ID; may be absent
    contentHash: text('content_hash').notNull(), // sha256 of normalized body; always present
    emailSubject: text('email_subject'),
    emailFrom: text('email_from'),
    emailReceivedAt: timestamp('email_received_at', { withTimezone: true }),
    rawBodySnapshot: text('raw_body_snapshot'),

    // Extraction result.
    status: astreaEmailStatusEnum('status').notNull(),
    extractionMethod: astreaExtractionMethodEnum('extraction_method'),
    extractedCnj: text('extracted_cnj'),
    extractedData: jsonb('extracted_data'), // full extracted payload (all movements in this email)
    matchedExecutionCaseId: uuid('matched_execution_case_id').references(() => executionCases.id),

    timelineEventsCreated: integer('timeline_events_created').notNull().default(0),

    errorDetails: text('error_details'),

    // Manual triage (orphan / parse_failed resolution).
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewNotes: text('review_notes'),

    // Which Gmail subfolder the message was moved to, for the redundant audit trail.
    movedToFolder: text('moved_to_folder'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('astrea_email_logs_message_id_unique').on(table.messageId),
    index('astrea_email_logs_content_hash_idx').on(table.contentHash),
    index('astrea_email_logs_org_status_idx').on(table.organizationId, table.status),
    index('astrea_email_logs_status_created_idx').on(table.status, table.createdAt),
    index('astrea_email_logs_cnj_idx').on(table.extractedCnj),
  ]
)

export type AstreaEmailLog = typeof astreaEmailLogs.$inferSelect
export type NewAstreaEmailLog = typeof astreaEmailLogs.$inferInsert
