/**
 * system_health_checks
 *
 * One row per execution of the Astrea IMAP poller (success or failure), plus
 * volume metrics for that run. This is the source of truth the daily
 * system-health-sweep reads to decide whether to alert the office — never
 * derived from inference, always an explicit recorded fact.
 */

import { pgTable, uuid, text, timestamp, integer, index, pgEnum } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'

export const healthCheckTypeEnum = pgEnum('health_check_type', [
  'astrea_email_poll',
  'aasp_webhook_received',
])

export const healthCheckStatusEnum = pgEnum('health_check_status', ['success', 'failure'])

export const systemHealthChecks = pgTable(
  'system_health_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    checkType: healthCheckTypeEnum('check_type').notNull(),
    status: healthCheckStatusEnum('status').notNull(),

    emailsFound: integer('emails_found').notNull().default(0),
    emailsProcessed: integer('emails_processed').notNull().default(0),
    emailsOrphan: integer('emails_orphan').notNull().default(0),
    emailsParseFailed: integer('emails_parse_failed').notNull().default(0),

    errorDetails: text('error_details'),
    durationMs: integer('duration_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('system_health_checks_org_type_created_idx').on(
      table.organizationId,
      table.checkType,
      table.createdAt
    ),
  ]
)

export type SystemHealthCheck = typeof systemHealthChecks.$inferSelect
export type NewSystemHealthCheck = typeof systemHealthChecks.$inferInsert
