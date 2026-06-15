/**
 * Review decision — append-only audit of human approve/reject actions.
 */

import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { documents } from './document.ts'
import { users } from './user.ts'
import { reviewSubjectTypeEnum, reviewDecisionEnum } from './_enums-review.ts'

export const reviewDecisions = pgTable(
  'review_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    subjectType: reviewSubjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    documentId: uuid('document_id').references(() => documents.id),
    snapshotKind: text('snapshot_kind'),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    decision: reviewDecisionEnum('decision').notNull(),
    reason: text('reason').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('review_decisions_subject_idx').on(
      table.organizationId,
      table.subjectType,
      table.subjectId
    ),
    index('review_decisions_reviewer_idx').on(
      table.organizationId,
      table.reviewerUserId,
      table.reviewedAt
    ),
  ]
)

export type ReviewDecisionRecord = typeof reviewDecisions.$inferSelect
export type NewReviewDecisionRecord = typeof reviewDecisions.$inferInsert
