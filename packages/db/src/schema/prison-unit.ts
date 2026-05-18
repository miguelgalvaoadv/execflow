/**
 * PrisonUnit — reference catalog of prison establishments (unidades prisionais).
 *
 * Prison units are the physical locations where clients serve their sentences.
 * They appear in:
 * - ExecutionCustodySnapshot (current/historical regime + unit)
 * - VisitNote (where the visit occurred)
 * - SentenceSnapshot (provenance context)
 *
 * SCOPE:
 * - organization_id = NULL → system-global record (shared across all orgs)
 * - organization_id = UUID → org-specific custom entry (extends or overrides global)
 *
 * Global records are maintained by the platform and cover public prison units.
 * Orgs may create their own entries for unlisted or custom facilities.
 *
 * NORMALIZATION:
 * This is a reference catalog — it does NOT store time-varying regime data.
 * The question "what regime does this unit support?" is answered by
 * regime_capabilities (a JSONB array), but the ACTUAL regime of a client
 * lives in ExecutionCustodySnapshot, not here.
 *
 * IMMUTABILITY:
 * id is immutable. name, code, and other fields may change over time
 * (prison units get renamed, transferred to different jurisdictions).
 * Changes are mutable with AuditLog.
 *
 * NO HARD DELETE:
 * Prison units referenced by custody history must NEVER be deleted.
 * Use active=false to retire units from active selection.
 * data-model-v1.md §2.4: "inactive units remain for history."
 *
 * Architecture ref: data-model-v1.md §2.4, execution-engine.md §2.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'

export const prisonUnits = pgTable(
  'prison_units',
  {
    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Tenant scope.
     * NULL → global/platform record visible to all organizations.
     * UUID → org-specific entry, only visible within that organization.
     * Architecture ref: data-model-v1.md §2.4 "system-wide or organization_id."
     */
    organizationId: uuid('organization_id').references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Core identification
    // -------------------------------------------------------------------------

    /**
     * Official or widely-used name of the prison unit.
     * Example: "Penitenciária Estadual de Presidente Prudente I"
     */
    name: text('name').notNull(),

    /**
     * Official code or internal reference.
     * Brazilian state systems use codes like "SAP-030" or "SEEU-002".
     * Unique per scope (global: across all global records; org: across org records).
     * Used for deduplication and integration matching.
     */
    code: text('code').notNull(),

    // -------------------------------------------------------------------------
    // Geographic classification
    // -------------------------------------------------------------------------

    /**
     * Brazilian state code (UF — Unidade Federativa).
     * Two-letter uppercase: 'SP', 'RJ', 'MG', 'RS', etc.
     * Used for: jurisdiction grouping, playbook selection, SLA configuration.
     * NULL for federal or cross-state facilities.
     */
    stateCode: text('state_code'),

    /** Municipality name. Used for operational routing and address display. */
    city: text('city'),

    // -------------------------------------------------------------------------
    // Capability metadata
    // -------------------------------------------------------------------------

    /**
     * Which custody regimes this facility is authorized to house.
     * Format: array of regime_type values.
     * Example: ["fechado", "semiaberto"]
     * Used for: data validation (can this unit house regime X?), routing.
     * NOT authoritative for legal progression decisions — playbook governs that.
     * data-model-v1.md §2.4: "regime_capabilities: JSON — which regimes facility supports."
     */
    regimeCapabilities: jsonb('regime_capabilities').notNull().default([]),

    // -------------------------------------------------------------------------
    // Extended metadata (for future integrations)
    // -------------------------------------------------------------------------

    /**
     * Administrative authority / secretaria responsible.
     * Examples: "SAP-SP", "SEAP-RJ", "DEPEN" (federal)
     * Used for future integration routing (e.g., tribunal system connectors).
     */
    administrativeAuthority: text('administrative_authority'),

    /**
     * Official CNPJ of the institution, if available.
     * Useful for official integration matching.
     */
    cnpj: text('cnpj'),

    // -------------------------------------------------------------------------
    // Active flag
    // -------------------------------------------------------------------------

    /**
     * Whether this unit is currently operational and selectable.
     * FALSE: unit deactivated or closed. Existing history references remain valid.
     * Never hard-delete units referenced in custody history.
     */
    active: boolean('active').notNull().default(true),

    // -------------------------------------------------------------------------
    // Timestamps
    // -------------------------------------------------------------------------

    /** When this record was created. Immutable. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Last time any mutable field was updated. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Code uniqueness within scope.
     * Global: unique across all global records (organization_id IS NULL).
     * Org-specific: unique within that organization.
     * The unique index covers both via nullable org: PostgreSQL treats
     * (code, NULL) as distinct from (code, 'uuid'), so different orgs can
     * have the same code as the global record.
     */
    uniqueIndex('prison_units_code_org_unique').on(table.code, table.organizationId),

    /** Browse by state + active status. */
    index('prison_units_state_idx').on(table.stateCode, table.active),

    /** Org-scoped lookup. */
    index('prison_units_org_idx').on(table.organizationId, table.active),
  ]
)

export type PrisonUnit = typeof prisonUnits.$inferSelect
export type NewPrisonUnit = typeof prisonUnits.$inferInsert
