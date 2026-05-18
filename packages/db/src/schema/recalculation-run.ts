/**
 * RecalculationRun — tracks cascading recalculation propagation chains.
 *
 * When a dependency changes (SentenceSnapshot superseded, TimelineEvent appended,
 * PlaybookVersion published), the engine must re-evaluate all affected cases.
 * RecalculationRun tracks:
 * - What triggered the recalculation
 * - Which cases are affected
 * - Which engine runs were superseded
 * - The propagation chain for replay
 *
 * A single event can trigger a chain: snapshot superseded → recalculation →
 * new opportunities → stale queue projections → re-evaluation.
 *
 * APPEND-ONLY: recalculation records are never deleted.
 *
 * Architecture ref: execution-engine.md §1.6 (recalculation events),
 *                   data-model-v1.md §5.3 (recalculations).
 */

import { pgTable, uuid, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { engineRuns } from './engine-run.ts'
import { recalculationRunStatusEnum } from './_enums-engine.ts'

export const recalculationRuns = pgTable(
  'recalculation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The case being recalculated.
     */
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Trigger — what caused this recalculation
    // -------------------------------------------------------------------------

    /**
     * Type of entity that triggered this recalculation.
     * Examples: 'sentence_snapshot', 'timeline_event', 'playbook_version'
     */
    triggerEntityType: text('trigger_entity_type').notNull(),

    /**
     * ID of the triggering entity.
     */
    triggerEntityId: uuid('trigger_entity_id').notNull(),

    /**
     * Human-readable description of why recalculation was triggered.
     * Example: 'SentenceSnapshot superseded after remição homologada'
     */
    triggerReason: text('trigger_reason').notNull(),

    // -------------------------------------------------------------------------
    // Chain tracking — for cascading propagation
    // -------------------------------------------------------------------------

    /**
     * The recalculation run that caused THIS run (for cascading chains).
     * Null for the root cause run.
     */
    parentRecalculationRunId: uuid('parent_recalculation_run_id'),

    /**
     * Depth of the recalculation chain (0 = root cause).
     * Used to detect infinite propagation loops.
     * Engine enforces max depth (e.g., 10) to prevent runaway chains.
     */
    chainDepth: integer('chain_depth').notNull().default(0),

    // -------------------------------------------------------------------------
    // Status and outcome
    // -------------------------------------------------------------------------

    status: recalculationRunStatusEnum('status').notNull().default('scheduled'),

    /**
     * The engine run produced by this recalculation (after completion).
     */
    producedEngineRunId: uuid('produced_engine_run_id').references(() => engineRuns.id),

    /**
     * The engine runs superseded by this recalculation.
     * JSON: string[] — EngineRun IDs
     */
    supersededEngineRunIds: jsonb('superseded_engine_run_ids').notNull().default([]),

    /**
     * Whether a material change was detected (vs a no-op recalculation).
     * False = all outputs identical; no new Opportunities or snapshot proposals.
     */
    materialChangeDetected: jsonb('material_change_detected').notNull().default(false),

    /**
     * Summary of changes detected (for auditing and dashboard).
     * JSON: { opportunitiesAdded: number, opportunitiesRemoved: number, snapshotDelta: boolean }
     */
    changeSummary: jsonb('change_summary'),

    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /**
     * Error if status = 'failed'.
     */
    errorDetails: text('error_details'),

    correlationId: uuid('correlation_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('recalculation_runs_case_idx').on(table.executionCaseId, table.scheduledAt),
    index('recalculation_runs_org_status_idx').on(table.organizationId, table.status),
    index('recalculation_runs_trigger_idx').on(
      table.triggerEntityType,
      table.triggerEntityId
    ),
    index('recalculation_runs_parent_idx').on(table.parentRecalculationRunId),
  ]
)

export type RecalculationRun = typeof recalculationRuns.$inferSelect
export type NewRecalculationRun = typeof recalculationRuns.$inferInsert
