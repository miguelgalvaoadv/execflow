/**
 * OrgPlaybookConfig — organization-wide playbook interpretation settings.
 *
 * Stores the firm's default interpretation branches and strategy profile.
 * These govern which rule branch is used when multiple branches exist and
 * the case has no per-case override.
 *
 * Resolution order (highest wins):
 *   CasePlaybookContext (per-case) > OrgPlaybookConfig > PlaybookVersion defaults
 *
 * MUTABLE: org admins and legal leads may update branch defaults. Changes
 * are audited (AuditLog) and apply to NEW engine runs only — confirmed
 * snapshots are not retroactively recomputed without explicit recalculation.
 *
 * Architecture ref: playbook-system.md §5.2.
 */

import { pgTable, uuid, text, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { playbookFamilies } from './playbook-family.ts'
import { users } from './user.ts'
import { strategyProfileEnum } from './_enums-engine.ts'

export const orgPlaybookConfigs = pgTable(
  'org_playbook_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The playbook family this config applies to.
     */
    familyId: uuid('family_id')
      .notNull()
      .references(() => playbookFamilies.id),

    /**
     * Office-wide strategy profile — playbook-system.md §5.3.
     */
    strategyProfile: strategyProfileEnum('strategy_profile').notNull().default('standard'),

    /**
     * Default branch selection per rule_id — playbook-system.md §5.2.
     * JSON: Record<ruleId, branchId>
     * Example: { 'progression.closed_to_semi.fraction.general': 'remission_numerator_homologated_only' }
     * Engine merges: org default > playbook version default.
     */
    defaultBranches: jsonb('default_branches').notNull().default({}),

    /**
     * Optional notes from the legal lead about interpretation philosophy.
     */
    notes: text('notes'),

    lastUpdatedByUserId: uuid('last_updated_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('org_playbook_configs_org_family_uniq').on(table.organizationId, table.familyId),
    index('org_playbook_configs_org_idx').on(table.organizationId),
  ]
)

export type OrgPlaybookConfig = typeof orgPlaybookConfigs.$inferSelect
export type NewOrgPlaybookConfig = typeof orgPlaybookConfigs.$inferInsert
