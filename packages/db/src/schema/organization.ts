/**
 * Organization — the top-level multi-tenant boundary in EXECFLOW.
 *
 * Every business entity (Client, ExecutionCase, Document, AuditLog row, etc.)
 * belongs to exactly one organization. Cross-organization data access is
 * architecturally forbidden. Architecture ref: ARCHITECTURE_RULES.md §M-01, §M-02.
 *
 * Immutable fields after creation: id, created_at, slug.
 * The slug is used for URL routing and external references; changing it would
 * break existing links and must be treated as a major migration.
 *
 * No hard-delete path — organizations with any legal history are deactivated,
 * not deleted. data-model-v1.md conventions apply.
 */

import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { organizationStatusEnum } from './_enums.ts'

export const organizations = pgTable('organizations', {
  // -------------------------------------------------------------------------
  // Identity (immutable after creation)
  // -------------------------------------------------------------------------

  /** Opaque UUID primary key. Never expose sequential IDs to prevent enumeration. */
  id: uuid('id').primaryKey().defaultRandom(),

  /**
   * URL-safe unique identifier for the organization.
   * Used in routing and external references. Immutable after creation.
   * Format: lowercase alphanumeric + hyphens, 3–48 chars.
   */
  slug: text('slug').notNull().unique(),

  // -------------------------------------------------------------------------
  // Display
  // -------------------------------------------------------------------------

  /** Human-readable organization name (law firm name). */
  name: text('name').notNull(),

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Organization status.
   * Transitions: active ↔ suspended; active → deactivated (terminal).
   * Deactivated organizations retain all child data for legal traceability.
   * State machine enforcement is at the service layer, not DB constraints.
   */
  status: organizationStatusEnum('status').notNull().default('active'),

  // -------------------------------------------------------------------------
  // Locale and operational settings
  // -------------------------------------------------------------------------

  /**
   * IANA timezone identifier for this organization.
   * Used for: deadline display, daily digest timing, SLA calculations.
   * Architecture ref: event-state-architecture.md §10.7 (timezone handling).
   * All stored timestamps remain UTC — this field governs display only.
   * Default: 'America/Sao_Paulo' for Brazilian criminal execution practice.
   */
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),

  /**
   * Organization-level configurable settings.
   * Stores operational configuration that changes org behavior without a schema migration:
   * - overload_threshold: integer (default 50) — queue depth triggering overload signal
   * - quiet_hours: { start: "22:00", end: "07:00" } — notification quiet window
   * - ai_trust_level: per-agent-type trust configuration
   * - notification_digest_time: "08:00" — daily digest delivery time
   *
   * NEVER store legal rule parameters here — those belong in PlaybookVersion records.
   * Architecture ref: playbook-system.md §9 (forbidden hardcoded logic).
   */
  settings: jsonb('settings').notNull().default({}),

  // -------------------------------------------------------------------------
  // Timestamps
  // -------------------------------------------------------------------------

  /** When the organization was created. Immutable. */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  /** Last time any mutable field on this record was updated. */
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  /**
   * When the organization was deactivated, if ever.
   * Null for active organizations. Set when status → deactivated.
   * Immutable once set — deactivation is a terminal event.
   */
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
})

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
