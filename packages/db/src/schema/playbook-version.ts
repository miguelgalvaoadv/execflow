/**
 * PlaybookVersion — immutable published snapshot of legal rules.
 *
 * Once status = 'published', no rule values may change. Law changes require
 * a new PlaybookVersion with a new version_id. Prior versions are retained
 * for historical replay (answer "what rules applied on date X?").
 *
 * APPEND-ONLY CONTRACT (for published rows):
 * - Published rows: NO UPDATE except retire (status → 'retired', effective_to set).
 * - Draft/review rows: editable until publish.
 * - content_hash is computed at publish time; verifies integrity of rule_groups.
 *
 * RULE_GROUPS JSON STRUCTURE:
 * {
 *   groups: [{
 *     groupId: string,            // e.g. 'progression_fractions'
 *     label: string,
 *     rules: [{
 *       ruleId: string,           // e.g. 'progression.closed_to_semi.fraction.general'
 *       evaluatorId: string,      // which evaluator function to call
 *       cautionLevel: 'low' | 'elevated' | 'informational_only',
 *       requiresPartnerReview: boolean,
 *       branches: [{
 *         branchId: string,
 *         label: string,
 *         isDefault: boolean,
 *         parameters: Record<string, unknown>,  // domain-specific per evaluatorId
 *         legalReferences: string[],
 *         riskDisclosureText?: string,
 *       }],
 *     }],
 *   }],
 *   metadata: {
 *     changelog: string,
 *     legalReferences: string[],
 *     testPackIds: string[],
 *   }
 * }
 *
 * Architecture ref: playbook-system.md §2.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { users } from './user.ts'
import { playbookFamilies } from './playbook-family.ts'
import { playbookStatusEnum } from './_enums-engine.ts'

export const playbookVersions = pgTable(
  'playbook_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The family this version belongs to.
     */
    familyId: uuid('family_id')
      .notNull()
      .references(() => playbookFamilies.id),

    /**
     * Null for platform templates; set for org-specific versions.
     * Denormalized from family for query efficiency.
     */
    organizationId: uuid('organization_id').references(() => organizations.id),

    /**
     * Human semver or date label. Examples: 'v2026.03.1', '2026-Q1'.
     */
    versionLabel: text('version_label').notNull(),

    /**
     * Lifecycle — see playbookStatusEnum.
     * Transitions: draft → review → published → retired.
     * Published rows: immutable except status may go to retired.
     */
    status: playbookStatusEnum('status').notNull().default('draft'),

    /**
     * Inclusive start of this version's legal validity.
     * Engine selection: effective_from <= evaluated_at.
     */
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),

    /**
     * Exclusive end. Null = currently active for new evaluations.
     * Set when a new version supersedes this one.
     */
    effectiveTo: timestamp('effective_to', { withTimezone: true }),

    /**
     * The previous version in this family's version chain.
     * Enables: "what changed from last version?"
     */
    supersesesVersionId: uuid('supersedes_version_id').references(
      (): AnyPgColumn => playbookVersions.id
    ),

    /**
     * Complete rule groups payload.
     * Frozen at publish time. See JSDoc header for schema.
     */
    ruleGroups: jsonb('rule_groups').notNull().default({}),

    /**
     * SHA-256 hash of rule_groups JSON at publish time.
     * Detects tampering. Computed and set during publish action.
     */
    contentHash: text('content_hash'),

    /**
     * Legal references this version applies — statutes, súmulas, decrees.
     * JSON: string[]
     */
    legalReferences: jsonb('legal_references').notNull().default([]),

    /**
     * Who published this version.
     * Must hold admin or legal_lead role (enforced at service layer).
     */
    publishedByUserId: uuid('published_by_user_id').references(() => users.id),

    /**
     * When this version was frozen (published). Null until published.
     */
    publishedAt: timestamp('published_at', { withTimezone: true }),

    createdByUserId: uuid('created_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('playbook_versions_family_status_idx').on(table.familyId, table.status),
    index('playbook_versions_org_status_idx').on(table.organizationId, table.status),
    /**
     * ENGINE SELECTION: resolves which version applies at instant T.
     * Pattern: WHERE family_id = ? AND status = 'published'
     *   AND effective_from <= T AND (effective_to IS NULL OR effective_to > T)
     */
    index('playbook_versions_effective_idx').on(
      table.familyId,
      table.effectiveFrom,
      table.effectiveTo
    ),
    unique('playbook_versions_family_label_uniq').on(table.familyId, table.versionLabel),
  ]
)

export type PlaybookVersion = typeof playbookVersions.$inferSelect
export type NewPlaybookVersion = typeof playbookVersions.$inferInsert
