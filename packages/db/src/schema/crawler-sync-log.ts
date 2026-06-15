import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import { pgEnum } from 'drizzle-orm/pg-core'

export const crawlerSyncStatusEnum = pgEnum('crawler_sync_status', ['pending', 'running', 'success', 'failed'])

/**
 * crawler_sync_logs
 * 
 * Records attempts to sync a case with an external tribunal system via background workers.
 */
export const crawlerSyncLogs = pgTable(
  'crawler_sync_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    executionCaseId: uuid('execution_case_id')
      .references(() => executionCases.id)
      .notNull(),
    
    status: crawlerSyncStatusEnum('status').default('pending').notNull(),
    tribunalName: text('tribunal_name'), // e.g. 'SEEU', 'TJSP'
    
    // Tracking execution time
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    
    // If failed, store error
    errorDetails: text('error_details'),

    // Audit
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
  },
  (table) => ({
    orgStatusIdx: index('crawler_sync_logs_org_status_idx').on(table.organizationId, table.status),
    caseIdx: index('crawler_sync_logs_case_idx').on(table.executionCaseId),
  })
)
