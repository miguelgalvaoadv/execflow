/**
 * ExecutionCustodySnapshot — append-only record of custody regime and location.
 *
 * Every change in a client's regime or prison unit creates a NEW row here.
 * No existing row is ever updated or deleted. This is the legal history of
 * where a client was and under what regime at any point in time.
 *
 * APPEND-ONLY CONTRACT:
 * - No UPDATE statements are ever issued against this table.
 * - No DELETE statements are ever issued against this table.
 * - No deleted_at column exists (append-only, not soft-deletable).
 * - Corrections create a new row with amends_snapshot_id referencing the error.
 *   The error row remains in history but is marked as superseded.
 * Architecture ref: ENGINEERING_PRINCIPLES.md §2, event-state-architecture.md §1.2.
 *
 * TWO-CLOCK PRINCIPLE (critical):
 * - effective_at: LEGAL TIME — when this regime/unit actually became effective.
 *   This is the court order date, the transfer date, the LEP art. 112 date.
 *   It may be MONTHS in the past (retroactive recording of historical facts).
 * - recorded_at: SYSTEM TIME — when the EXECFLOW database row was inserted.
 *   Always the current server clock at INSERT time.
 *
 * These MUST be stored and used separately. Conflating them is an architecture defect
 * that makes correct temporal queries and replay impossible.
 * Architecture ref: event-state-architecture.md §10.2, §10.4.
 *
 * CURRENT CUSTODY QUERY PATTERN:
 * Current regime = latest confirmed row WHERE effective_at <= NOW()
 *   AND superseded_at IS NULL ORDER BY effective_at DESC LIMIT 1
 *
 * POINT-IN-TIME REPLAY PATTERN:
 * Regime on date X = latest confirmed row WHERE effective_at <= X
 *   AND (superseded_at IS NULL OR superseded_at > X) ORDER BY effective_at DESC LIMIT 1
 *
 * CONFIRMATION REQUIREMENT:
 * Only confirmed rows are used for engine computations.
 * A proposed custody change must be reviewed before the engine considers it.
 * Architecture ref: ARCHITECTURE_RULES.md §D-03.
 *
 * Architecture ref: data-model-v1.md §3.1, execution-workflows.md §2.3,
 *                   execution-engine.md §2.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { prisonUnits } from './prison-unit.ts'
import { users } from './user.ts'
import { regimeTypeEnum, confidenceLevelEnum } from './_enums-domain.ts'

export const custodySnapshots = pgTable(
  'execution_custody_snapshots',
  {
    // -------------------------------------------------------------------------
    // Identity (immutable)
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Denormalized org for query scoping.
     * All queries against this table include organization_id.
     * Immutable after creation.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The execution case this snapshot belongs to.
     * Immutable after creation.
     */
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Custody state (what changed)
    // -------------------------------------------------------------------------

    /**
     * The penal regime at this point in the custody history.
     * Architecture ref: execution-engine.md §2 (temporal events affecting regime).
     */
    regime: regimeTypeEnum('regime').notNull(),

    /**
     * The prison unit where the client is held under this regime.
     * NULL when regime = 'aberto', 'albergue', or 'domiciliar' (no prison facility).
     * Also NULL when the unit is unknown (e.g., transfer pending confirmation).
     */
    prisonUnitId: uuid('prison_unit_id').references(() => prisonUnits.id),

    // -------------------------------------------------------------------------
    // Temporal — THE KEY DISTINCTION
    // -------------------------------------------------------------------------

    /**
     * LEGAL TIME: When this regime/unit combination became legally effective.
     *
     * Source hierarchy (use the earliest authoritative date available):
     * 1. Court order date (despacho de progressão, mandado de prisão)
     * 2. Prison transfer document date
     * 3. LEP/CPP legal calculation date (e.g., data-base for progressão)
     * 4. Human-provided approximate date (lower confidence)
     *
     * This date determines: which fraction fractions apply, when deadlines
     * begin counting, and how the engine reconstructs timeline state.
     *
     * NEVER use recorded_at for legal calculations. Use effective_at.
     * Architecture ref: execution-engine.md §0 (two clocks principle).
     */
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),

    /**
     * SYSTEM TIME: When this row was inserted into the database.
     * Immutable (set by defaultNow(), never updated).
     * Used for: ingestion SLA, ordering rows with identical effective_at,
     * debugging retroactive data entry.
     *
     * For custody snapshots confirmed years after the fact (e.g., importing
     * historical records), recorded_at will be recent while effective_at is old.
     */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Confidence (for uncertain historical reconstruction)
    // -------------------------------------------------------------------------

    /**
     * How confident we are that effective_at and regime are accurate.
     * Drives human review prioritization and engine uncertainty handling.
     * Architecture ref: execution-engine.md §5 (legal uncertainty model).
     */
    confidence: confidenceLevelEnum('confidence').notNull().default('medium'),

    // -------------------------------------------------------------------------
    // Attribution and provenance
    // -------------------------------------------------------------------------

    /**
     * The TimelineEvent that caused this custody change.
     * Examples: 'prison.transfer', 'sentence.progressao', 'discipline.falta_grave'
     * Stored as text (not FK) because timeline_events may not exist yet
     * when the custody snapshot is created (OCR import scenario).
     * The FK relationship is logical, enforced at service layer.
     */
    sourceEventId: uuid('source_event_id'),

    /**
     * Free-text notes about this custody period.
     * Example: "Progressão deferida pelo Juiz Fulano em 15/03/2023"
     */
    notes: text('notes'),

    // -------------------------------------------------------------------------
    // Confirmation (required before engine consumption)
    // -------------------------------------------------------------------------

    /**
     * The user who confirmed this snapshot.
     * ARCHITECTURE_RULES.md §D-03: engine only consumes confirmed snapshots.
     * NULL until a lawyer or admin reviews and confirms.
     */
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id),

    /**
     * When the confirmation happened.
     * NULL until confirmed. Must be set at the same time as confirmed_by_user_id.
     */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedByUserId: uuid('rejected_by_user_id').references(() => users.id),

    // -------------------------------------------------------------------------
    // Amendment chain (corrections via new rows, never in-place)
    // -------------------------------------------------------------------------

    /**
     * When this snapshot was superseded by a newer one.
     * NULL for the current (non-superseded) snapshot.
     * Set when a newer snapshot covers the same or later effective_at range.
     * NEVER delete superseded snapshots — they are historical facts.
     * Architecture ref: ENGINEERING_PRINCIPLES.md §2.
     */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),

    /**
     * The newer snapshot that superseded this one.
     * NULL for current (active) snapshots.
     * Together with superseded_at, enables: "show me the full correction history."
     */
    supersededBySnapshotId: uuid('superseded_by_snapshot_id').references(
      (): AnyPgColumn => custodySnapshots.id
    ),

    /**
     * When this snapshot CORRECTS a prior incorrect snapshot.
     * Set on the NEW (corrective) row, pointing to the row being corrected.
     * The old row remains with superseded_at set.
     */
    amendsSnapshotId: uuid('amends_snapshot_id').references(
      (): AnyPgColumn => custodySnapshots.id
    ),
  },
  (table) => [
    /**
     * PRIMARY QUERY: current and historical custody for a case.
     * Supports both: "current regime" and "regime on date X" patterns.
     * DESC ordering so latest effective_at is first.
     */
    index('custody_snapshots_case_effective_idx').on(
      table.executionCaseId,
      table.effectiveAt
    ),

    /**
     * CONFIRMATION QUERY: unconfirmed snapshots for review queue.
     * pattern: WHERE confirmed_by_user_id IS NULL AND org = ?
     */
    index('custody_snapshots_unconfirmed_idx').on(
      table.organizationId,
      table.confirmedByUserId
    ),

    /**
     * ORG-SCOPED QUERY: all custody snapshots for org (audit/compliance).
     */
    index('custody_snapshots_org_idx').on(table.organizationId, table.recordedAt),
  ]
)

export type CustodySnapshot = typeof custodySnapshots.$inferSelect
export type NewCustodySnapshot = typeof custodySnapshots.$inferInsert
