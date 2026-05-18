/**
 * PlaybookFamily — top-level identity for a versioned legal rule collection.
 *
 * A PlaybookFamily groups all versions of a named playbook product
 * (e.g., "execflow-br-lep-default"). Individual published versions are in
 * playbook_versions with a FK to this table.
 *
 * IMMUTABLE after creation — name/slug/jurisdiction are identity, not config.
 * Org-scoped families override platform families for rule resolution.
 *
 * Architecture ref: playbook-system.md §1.2, §2.1.
 */

import { pgTable, uuid, text, boolean, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'

export const playbookFamilies = pgTable(
  'playbook_families',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Null for platform-provided base playbooks (BR-FED etc).
     * Set for org-specific overlay families.
     * Architecture ref: playbook-system.md §2.4 (resolution order).
     */
    organizationId: uuid('organization_id').references(() => organizations.id),

    /**
     * Machine-readable identifier. Stable across version upgrades.
     * Examples: 'execflow-br-lep-default', 'org-abc-overlay'
     */
    slug: text('slug').notNull(),

    /**
     * Human display name.
     */
    name: text('name').notNull(),

    /**
     * Jurisdiction scope this family applies to.
     * Examples: 'BR-FED', 'BR-SP', 'ORG-{id}-OVERLAY'
     * Architecture ref: playbook-system.md §2.4.
     */
    jurisdictionScope: text('jurisdiction_scope').notNull(),

    /**
     * Whether this family is an org overlay (true) or a platform base (false).
     * Overlay families override base families for the same rule_id.
     */
    isOverlay: boolean('is_overlay').notNull().default(false),

    description: text('description'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('playbook_families_slug_org_uniq').on(table.slug, table.organizationId),
    index('playbook_families_org_idx').on(table.organizationId),
    index('playbook_families_jurisdiction_idx').on(table.jurisdictionScope),
  ]
)

export type PlaybookFamily = typeof playbookFamilies.$inferSelect
export type NewPlaybookFamily = typeof playbookFamilies.$inferInsert
