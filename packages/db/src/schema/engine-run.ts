/**
 * EngineRun — record of a single legal computation engine evaluation.
 *
 * Every evaluation of a case's legal state produces an EngineRun. The run
 * links to the playbook version used, the inputs consumed, and the outputs
 * produced. This enables full replay ("re-run this evaluation with the same
 * inputs and rules") and historical audit.
 *
 * APPEND-ONLY: EngineRuns are never modified after completion. Superseded
 * runs remain for replay. A case may have many runs; the latest completed
 * run is the operational current view.
 *
 * EVALUATION ARCHITECTURE:
 * 1. Loader: reads confirmed snapshots, timeline events, documents
 * 2. Resolver: selects the applicable playbook version at evaluated_at
 * 3. Merger: applies org config + case context overrides
 * 4. Evaluator: pure rule evaluation (no DB writes inside rules)
 * 5. Committer: persists outputs (Opportunities, ExplanationBundles, this row)
 *
 * Architecture ref: execution-engine.md §4 (opportunity computation),
 *                   playbook-system.md §7.1 (engine run playbook reference).
 */

import { pgTable, uuid, text, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import { playbookVersions } from './playbook-version.ts'
import {
  engineRunStatusEnum,
  engineRunTriggerEnum,
  strategyProfileEnum,
  uncertaintyLevelEnum,
} from './_enums-engine.ts'

export const engineRuns = pgTable(
  'engine_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Playbook provenance — mandatory for every run
    // -------------------------------------------------------------------------

    /**
     * Primary playbook version used for this run.
     * Architecture ref: playbook-system.md §7.1.
     */
    playbookVersionId: uuid('playbook_version_id')
      .notNull()
      .references(() => playbookVersions.id),

    /**
     * Org overlay version used (if any). Null for platform-only evaluation.
     */
    overlayVersionId: uuid('overlay_version_id').references(() => playbookVersions.id),

    /**
     * Per-case context applied (if any). Null if no case override was active.
     */
    caseContextId: uuid('case_context_id'),

    /**
     * The resolved strategy profile for this run.
     */
    strategyProfile: strategyProfileEnum('strategy_profile').notNull().default('standard'),

    // -------------------------------------------------------------------------
    // Temporal
    // -------------------------------------------------------------------------

    /**
     * LEGAL EVALUATION TIME: the as-of instant for this run.
     * For standard runs: NOW().
     * For replay runs: a past instant requested by the user.
     * Architecture ref: execution-engine.md §7 (historical replay).
     */
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),

    /**
     * When the engine started processing (system time).
     */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * When the engine finished (system time). Null while running.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Status and trigger
    // -------------------------------------------------------------------------

    status: engineRunStatusEnum('status').notNull().default('running'),

    trigger: engineRunTriggerEnum('trigger').notNull(),

    /**
     * ID of the event/snapshot/document that triggered this run.
     * Null for manual or scheduled triggers.
     */
    triggerEntityType: text('trigger_entity_type'),
    triggerEntityId: uuid('trigger_entity_id'),

    /**
     * The user who requested evaluation (null for system-triggered).
     */
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id),

    // -------------------------------------------------------------------------
    // Confidence and uncertainty summary
    // -------------------------------------------------------------------------

    /**
     * Aggregate uncertainty level across all rule evaluations.
     * Worst-case (highest uncertainty) of all individual rule outputs.
     * Architecture ref: execution-engine.md §5.2 (composition rule: weakest link).
     */
    uncertaintyLevel: uncertaintyLevelEnum('uncertainty_level').notNull().default('none'),

    /**
     * Active global blocking codes that suppressed opportunity suggestions.
     * JSON: string[] — e.g. ['BLK_ESCAPE', 'BLK_SNAPSHOT_UNCONFIRMED']
     * Architecture ref: execution-engine.md §4.2.
     */
    blockingCodes: jsonb('blocking_codes').notNull().default([]),

    /**
     * Summary of missing data fields that reduced confidence.
     * JSON: [{ field: string, severity: 'critical'|'recommended'|'optional', reason: string }]
     */
    missingDataSummary: jsonb('missing_data_summary').notNull().default([]),

    // -------------------------------------------------------------------------
    // Outputs summary (denormalized for dashboard queries)
    // -------------------------------------------------------------------------

    /**
     * Count of Opportunity candidates created by this run.
     */
    opportunitiesCreated: jsonb('opportunities_created').notNull().default([]),

    /**
     * Count of warnings emitted.
     */
    warningsEmitted: jsonb('warnings_emitted').notNull().default([]),

    /**
     * Error details if status = 'failed'.
     */
    errorDetails: text('error_details'),

    // -------------------------------------------------------------------------
    // Replay metadata
    // -------------------------------------------------------------------------

    /**
     * Whether this run was a point-in-time replay (not a current evaluation).
     * Replay runs do NOT commit outputs (no Opportunities created).
     */
    isReplay: boolean('is_replay').notNull().default(false),

    /**
     * For superseded runs: the run that replaced this one.
     */
    supersededByRunId: uuid('superseded_by_run_id'),

    // Correlation/causation for distributed tracing
    correlationId: uuid('correlation_id'),
    causationId: uuid('causation_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('engine_runs_case_idx').on(table.executionCaseId, table.evaluatedAt),
    index('engine_runs_org_status_idx').on(table.organizationId, table.status),
    index('engine_runs_playbook_idx').on(table.playbookVersionId),
    index('engine_runs_correlation_idx').on(table.correlationId),
  ]
)

export type EngineRun = typeof engineRuns.$inferSelect
export type NewEngineRun = typeof engineRuns.$inferInsert
