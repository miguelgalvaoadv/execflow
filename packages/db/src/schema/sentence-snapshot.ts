/**
 * SentenceSnapshot — append-only, immutable record of sentence arithmetic state.
 *
 * This is the authoritative source for all sentence-time calculations.
 * Every time the sentence calculation changes — new documents, regime changes,
 * remição granted, recalculation triggered — a NEW row is inserted. Prior rows
 * are never modified.
 *
 * The execution engine reads ONLY 'confirmed' snapshots as inputs for
 * progression, benefit, and deadline calculations.
 *
 * APPEND-ONLY CONTRACT:
 * - NO UPDATE statements are ever issued against this table.
 * - NO DELETE statements are ever issued against this table.
 * - No updated_at column exists.
 * - No deleted_at column exists.
 * - Corrections: new row with amends_snapshot_id pointing to the incorrect row.
 * Architecture ref: ENGINEERING_PRINCIPLES.md §2, ARCHITECTURE_RULES.md §D-01.
 *
 * TWO-CLOCK PRINCIPLE (critical):
 * - effective_at: LEGAL TIME — as-of date for this arithmetic.
 *   This is the date the calculation is valid for: "sentence state AS OF mm/dd/yyyy."
 *   For a recalculation due to remição, this is the court order date.
 *   Engine progression checks: "is the fraction served by effective_at sufficient?"
 * - recorded_at: SYSTEM TIME — when this row was inserted.
 *   Immutable. Set by defaultNow(). Used for audit and replay.
 *
 * CONFIRMATION GATE:
 * Only 'confirmed' rows are consumed by the execution engine.
 * Engine inputs: WHERE status = 'confirmed' ORDER BY effective_at DESC LIMIT 1
 * This prevents AI-generated or data-entry errors from triggering legal outputs.
 * Architecture ref: ARCHITECTURE_RULES.md §D-03.
 *
 * CONFIDENCE MODEL:
 * Every snapshot declares confidence_level. A snapshot with 'low' confidence
 * means significant missing data exists. The engine carries this uncertainty
 * into its outputs (propagating confidence downward).
 * Architecture ref: execution-engine.md §5 (legal uncertainty model).
 *
 * CALCULATION PROVENANCE:
 * calculation_method records the playbook version and logic that produced this
 * arithmetic. Source document IDs are stored in source_document_ids.
 * This enables: "show me why this calculation was produced."
 * Architecture ref: execution-engine.md §8 (explainability mandate).
 *
 * EXPLANATION BUNDLE:
 * The explanation JSON field carries a structured ExplanationBundle:
 * { basis: text, components: [{ name, value, unit, confidence, source_refs }],
 *   assumptions: string[], missing_data: string[], legal_citations: string[] }
 * This is what lawyers see when reviewing a calculation.
 * Architecture ref: execution-engine.md §8.
 *
 * Architecture ref: data-model-v1.md §3.2, execution-engine.md §1,
 *                   execution-workflows.md §3.3.
 */

import {
  pgTable,
  uuid,
  integer,
  numeric,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import { snapshotStatusEnum, confidenceLevelEnum } from './_enums-domain.ts'

export const sentenceSnapshots = pgTable(
  'sentence_snapshots',
  {
    // -------------------------------------------------------------------------
    // Identity (all fields immutable after creation)
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Tenant isolation. Immutable.
     * Denormalized from execution_case.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The execution case this snapshot belongs to.
     * Immutable.
     */
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Temporal — THE KEY DISTINCTION
    // -------------------------------------------------------------------------

    /**
     * LEGAL TIME: the as-of date for this sentence arithmetic.
     *
     * "This snapshot represents the sentence state as of [effective_at]."
     * Examples:
     * - Date of sentença trânsitada em julgado for initial snapshot.
     * - Date of court order granting remição for updated snapshot.
     * - Date-base for progressão calculation.
     *
     * The engine uses effective_at to: determine if progression fractions
     * are met, compute deadlines, and assess benefit eligibility windows.
     *
     * IMMUTABLE. Corrections create a new snapshot with amends_snapshot_id.
     * Architecture ref: execution-engine.md §0 (two clocks).
     */
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),

    /**
     * SYSTEM TIME: when this row was inserted.
     * Immutable. Set by defaultNow(). Never used in legal calculations.
     * Used for: audit, replay, ingestion lag monitoring.
     */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Review status
    // -------------------------------------------------------------------------

    /**
     * Lifecycle status for this snapshot.
     * proposed   → Created (by engine or assistant); awaiting lawyer review.
     * confirmed  → Lawyer confirmed arithmetic; eligible for engine consumption.
     * superseded → Replaced by a newer confirmed snapshot.
     *
     * ARCHITECTURE_RULES.md §D-03: engine ONLY reads confirmed snapshots.
     */
    status: snapshotStatusEnum('status').notNull().default('proposed'),

    // -------------------------------------------------------------------------
    // Core arithmetic (all in DAYS as the canonical unit)
    // -------------------------------------------------------------------------

    /**
     * Total sentence length in days.
     * Sum of all sentences after unification (cúmulo material / concurso formal / crime continuado
     * per playbook version).
     * IMMUTABLE after creation.
     */
    totalSentenceDays: integer('total_sentence_days').notNull(),

    /**
     * Days considered legally "cumpridos" (served) up to effective_at.
     * Includes: physical imprisonment days, house-arrest days (per playbook).
     * Excludes: days not counted due to disciplinary sanctions (per playbook).
     */
    servedDays: integer('served_days').notNull().default(0),

    /**
     * Days granted via remição (work, study, reading — LEP Art. 126).
     * Judicial confirmation required before inclusion.
     * Accumulated across all confirmed remição events up to effective_at.
     */
    remissionDays: integer('remission_days').notNull().default(0),

    /**
     * Days credited via detração penal (CPP Art. 387 §2, LEP Art. 42).
     * Includes: preventive detention, house arrest before conviction.
     * Applied against total_sentence_days before computing remaining.
     */
    detractionDays: integer('detraction_days').notNull().default(0),

    /**
     * Remaining penal debt in days.
     * Derived: total_sentence_days − served_days − remission_days − detraction_days.
     * Stored (not computed) for query performance.
     * Engine re-derives this and flags discrepancies as validation errors.
     */
    remainingDays: integer('remaining_days').notNull(),

    /**
     * Fraction of sentence served (served + remission + detraction) / total.
     * Precision: 5 digits, 4 decimal places → 0.0000 to 1.0000 (= 0.00% to 100.00%).
     * Example: 0.1667 = 16.67% served.
     * Used for: progressão fractions (1/6, 2/5, 3/5 per LEP/playbook).
     *
     * Achado 08/07/2026: estava marcado @deprecated ("usar crimes_breakdown
     * no Engine Phase 5B") mas essa migração nunca aconteceu — é o campo
     * mais lido do snapshot hoje (case-analysis.ts, snapshot-review.ts, a
     * tela do caso, o mapper de promoção do worker, o loader do engine).
     * Removido o @deprecated para não induzir a erro; se crimes_breakdown
     * vier a substituir isso de verdade, marcar de novo então.
     */
    percentServed: numeric('percent_served', { precision: 5, scale: 4 }).notNull(),

    // -------------------------------------------------------------------------
    // V2 Execution Penal Model (Crimes and Recidivism)
    // -------------------------------------------------------------------------

    /**
     * Execution penal foundation: Individual breakdown of sentences (múltiplos crimes).
     * Essential for calculating separate database dates and fractions.
     * Schema: Array of CrimeBreakdown objects.
     * {
     *   crimeCode: string,
     *   crimeName: string,
     *   article: string,
     *   law: string,
     *   sentenceDays: number,
     *   isHediondo: boolean,
     *   isEquiparado: boolean,
     *   hasResultingDeath: boolean,
     *   isAttempted: boolean,
     *   sentenceDate: string,
     *   transitDate: string
     * }
     */
    crimesBreakdown: jsonb('crimes_breakdown').notNull().default([]),

    /**
     * Whether the defendant is a generic recidivist.
     * Affects fractions for common crimes.
     */
    isGenericRecidivist: boolean('is_generic_recidivist').notNull().default(false),

    // -------------------------------------------------------------------------

    // Confidence
    // -------------------------------------------------------------------------

    /**
     * Overall confidence in this arithmetic.
     * high    → All documents present, no conflicting data, confirmed by multiple sources.
     * medium  → Most sources confirmed; minor assumptions noted in explanation.
     * low     → Missing key documents; significant assumptions; requires investigation.
     * unknown → Calculation is preliminary; sources not yet reviewed.
     *
     * Architecture ref: execution-engine.md §5.
     */
    confidenceLevel: confidenceLevelEnum('confidence_level').notNull().default('unknown'),

    // -------------------------------------------------------------------------
    // Calculation provenance
    // -------------------------------------------------------------------------

    /**
     * Human-readable description of the calculation method.
     * Example: "Progressão 1/6 - LEP Art. 112, regime fechado crime hediondo,
     *           playbook v2024-03-SP, calculated by engine v1.2"
     * Also serves as the version identifier for future playbook FK compatibility.
     */
    calculationMethod: text('calculation_method'),

    /**
     * Future FK: playbook_versions.id when that table is created in Phase 5+.
     * Stored now so existing snapshots can be linked retroactively.
     * NULL until playbook versioning is implemented.
     * Architecture ref: playbook-system.md §5 (version tracking).
     */
    playbookVersionId: uuid('playbook_version_id'),

    /**
     * For engine-automated calculations: the run ID that produced this snapshot.
     * Enables: "show me all engine outputs from this run."
     * NULL for manually-entered snapshots.
     */
    engineRunId: uuid('engine_run_id'),

    /**
     * Document IDs used as source data for this calculation.
     * Format: JSON array of Document UUIDs.
     * ["uuid1", "uuid2", ...]
     * Used for: "which documents support this arithmetic?"
     * Architecture ref: execution-engine.md §1.2 (components and provenance).
     */
    sourceDocumentIds: jsonb('source_document_ids').notNull().default([]),

    // -------------------------------------------------------------------------
    // Human confirmation
    // -------------------------------------------------------------------------

    /**
     * The user who confirmed this snapshot.
     * Must have 'lawyer' or 'admin' role (enforced at service layer).
     * NULL until confirmed.
     */
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id),

    /**
     * When the confirmation happened.
     * NULL until confirmed. Set atomically with status → 'confirmed'.
     */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Explanation bundle (structured, human-readable)
    // -------------------------------------------------------------------------

    /**
     * Structured explanation of how this arithmetic was derived.
     * Mandatory for engine-generated snapshots; strongly recommended for manual.
     *
     * JSON structure (ExplanationBundle):
     * {
     *   basis: string,          // Legal basis for calculation method
     *   components: [{          // Per-quantity breakdown
     *     name: string,
     *     value: number,
     *     unit: "days",
     *     confidence: "high"|"medium"|"low",
     *     sourceRefs: string[], // Document IDs or event IDs
     *     derivationNote: string
     *   }],
     *   assumptions: string[],   // Explicit assumptions made
     *   missingData: string[],   // What data would improve confidence
     *   legalCitations: string[] // LEP, CP, STJ/STF súmulas applied
     * }
     *
     * This is what gets rendered in the "Explain calculation" UI.
     * Architecture ref: execution-engine.md §8 (explainability mandate).
     */
    explanation: jsonb('explanation'),

    // -------------------------------------------------------------------------
    // Missing data flags
    // -------------------------------------------------------------------------

    /**
     * List of data elements that are absent or uncertain.
     * Format: [{ field: string, impact: "high"|"medium", description: string }]
     * Drives: "low confidence" display, review prioritization, missing-doc alerts.
     * Architecture ref: execution-workflows.md §1.3.
     */
    missingDataFlags: jsonb('missing_data_flags').notNull().default([]),

    // -------------------------------------------------------------------------
    // Amendment chain
    // -------------------------------------------------------------------------

    /**
     * When this snapshot CORRECTS an erroneous prior snapshot,
     * this points to the incorrect row being corrected.
     * The corrected row is NOT deleted; it remains for audit history.
     * NULL for original (non-corrective) snapshots.
     */
    amendsSnapshotId: uuid('amends_snapshot_id').references(
      (): AnyPgColumn => sentenceSnapshots.id
    ),

    // -------------------------------------------------------------------------
    // Origin attribution
    // -------------------------------------------------------------------------

    /**
     * Who initiated this snapshot calculation.
     * NULL for fully automated engine runs.
     * For manual entry: the lawyer/assistant who entered the data.
     */
    createdByUserId: uuid('created_by_user_id').references(() => users.id),

    /**
     * When this row was created. Immutable. Equivalent to recorded_at.
     * recorded_at is the primary temporal reference; created_at is provided
     * for consistency with other tables in this schema.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // NO updated_at, NO deleted_at — this table is APPEND-ONLY
    // -------------------------------------------------------------------------
  },
  (table) => [
    /**
     * PRIMARY ENGINE QUERY: latest confirmed snapshot for a case.
     * pattern: WHERE execution_case_id = ? AND status = 'confirmed'
     *          ORDER BY effective_at DESC LIMIT 1
     */
    index('sentence_snapshots_case_effective_idx').on(
      table.executionCaseId,
      table.effectiveAt
    ),

    /**
     * CONFIRMATION QUEUE: snapshots pending lawyer review.
     * pattern: WHERE status = 'proposed' AND org = ?
     */
    index('sentence_snapshots_status_idx').on(
      table.organizationId,
      table.status
    ),

    /**
     * REPLAY RECONSTRUCTION: ordered by both clocks.
     * "State of sentence arithmetic as known by system on date X."
     * Architecture ref: execution-engine.md §7 (historical replay).
     */
    index('sentence_snapshots_replay_idx').on(
      table.executionCaseId,
      table.recordedAt,
      table.effectiveAt
    ),

    /**
     * ENGINE RUN GROUPING: find all outputs from a single engine run.
     */
    index('sentence_snapshots_engine_run_idx').on(table.engineRunId),
  ]
)

export type SentenceSnapshot = typeof sentenceSnapshots.$inferSelect
export type NewSentenceSnapshot = typeof sentenceSnapshots.$inferInsert
