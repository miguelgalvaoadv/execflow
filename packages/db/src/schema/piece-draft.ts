import {
  pgTable, uuid, text, timestamp, index, pgEnum
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { opportunities } from './opportunity.ts'
import { users } from './user.ts'

export const pieceDraftStatusEnum = pgEnum('piece_draft_status', [
  'generating',
  'draft',
  'reviewing',
  'finalized',
  'failed'
])

export const pieceDrafts = pgTable(
  'piece_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id),

    status: pieceDraftStatusEnum('status').notNull().default('generating'),

    contentMarkdown: text('content_markdown'),

    /** Preenchido quando status='failed' (ex.: erro da API do Claude). */
    errorMessage: text('error_message'),
    
    // Model used for generation, e.g. "claude-3-5-sonnet"
    modelUsed: text('model_used'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    
    // Which user triggered the generation
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    
    // Which user finalized the draft
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    finalizedByUserId: uuid('finalized_by_user_id').references(() => users.id),
  },
  (table) => [
    index('piece_drafts_org_status_idx').on(table.organizationId, table.status),
    index('piece_drafts_opp_idx').on(table.opportunityId),
  ]
)

export type PieceDraft = typeof pieceDrafts.$inferSelect
export type NewPieceDraft = typeof pieceDrafts.$inferInsert
