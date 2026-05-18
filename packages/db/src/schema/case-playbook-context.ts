/**
 * CasePlaybookContext — per-case branch overrides and interpretation exceptions.
 *
 * Lawyers may override the firm's default branches for a specific ExecutionCase.
 * These overrides require a documented reason and are audited. They represent
 * the highest-priority interpretation in the resolution order.
 *
 * Resolution order (highest wins):
 *   CasePlaybookContext > OrgPlaybookConfig > PlaybookVersion defaults
 *
 * Use cases:
 * - Client's case has a special HC thesis that changes branch selection
 * - Decree eligibility waiver for a specific case
 * - Strategy profile exception authorized by managing partner
 *
 * APPEND-ONLY: overrides are never silently replaced. A new row supersedes
 * the prior context, preserving history of all branch decisions per case.
 *
 * Architecture ref: playbook-system.md §5.4.
 */

import { pgTable, uuid, text, timestamp, jsonb, index, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import { strategyProfileEnum } from './_enums-engine.ts'

export const casePlaybookContexts = pgTable(
  'case_playbook_contexts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    /**
     * Per-case branch overrides — playbook-system.md §5.4.
     * JSON: Record<ruleId, branchId>
     * These override org defaults for this case only.
     */
    branchOverrides: jsonb('branch_overrides').notNull().default({}),

    /**
     * Optional per-case strategy profile override.
     * Null = use org default.
     */
    strategyProfile: strategyProfileEnum('strategy_profile'),

    /**
     * Mandatory reason for the override — audit requirement.
     * Cannot be empty when branchOverrides is non-empty.
     */
    reason: text('reason').notNull(),

    /**
     * The lawyer who set this override (must have lawyer or admin role).
     */
    setByUserId: uuid('set_by_user_id')
      .notNull()
      .references(() => users.id),

    /**
     * Optional expiry — some overrides apply only to a specific proceeding window.
     */
    validUntil: timestamp('valid_until', { withTimezone: true }),

    /**
     * When this context was superseded by a newer context for the same case.
     * Null for the currently active context.
     */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),

    /**
     * Pointer to the newer context that supersedes this one.
     */
    supersededByContextId: uuid('superseded_by_context_id').references(
      (): AnyPgColumn => casePlaybookContexts.id
    ),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('case_playbook_contexts_case_idx').on(table.executionCaseId, table.createdAt),
    index('case_playbook_contexts_org_idx').on(table.organizationId),
  ]
)

export type CasePlaybookContext = typeof casePlaybookContexts.$inferSelect
export type NewCasePlaybookContext = typeof casePlaybookContexts.$inferInsert
