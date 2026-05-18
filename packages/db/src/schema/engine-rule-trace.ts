/**
 * EngineRuleTrace — append-only per-rule execution trace within an EngineRun.
 *
 * Every rule evaluated by the engine produces one trace record. This enables:
 * - Full replay with identical inputs producing identical outputs (determinism check)
 * - ExplanationBundle generation linking each conclusion to its rule trace
 * - Auditing which rules were evaluated and why they produced their outcome
 * - Future divergence detection when playbook versions change
 *
 * APPEND-ONLY CONTRACT:
 * - NO UPDATE or DELETE ever issued against this table.
 * - Failed rules still produce a trace with the failure reason.
 * - Rules that did not evaluate (blocked by predecessor) produce a 'skipped' trace.
 *
 * INPUTS HASH / OUTPUTS HASH:
 * - Computed as SHA-256 of the JSON-serialized inputs/outputs at evaluation time.
 * - Enables replay consistency check: same inputs + same rule + same version
 *   MUST produce the same outputs (determinism invariant).
 * - Architecture ref: execution-engine.md §0 (deterministic execution).
 *
 * Architecture ref: execution-engine.md §8 (explainability),
 *                   playbook-system.md §7.2 (explanations cite rules).
 */

import { pgTable, uuid, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { engineRuns } from './engine-run.ts'
import { ruleOutcomeEnum, uncertaintyLevelEnum } from './_enums-engine.ts'

export const engineRuleTraces = pgTable(
  'engine_rule_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The EngineRun this trace belongs to.
     */
    engineRunId: uuid('engine_run_id')
      .notNull()
      .references(() => engineRuns.id),

    // -------------------------------------------------------------------------
    // Rule identity
    // -------------------------------------------------------------------------

    /**
     * Stable semantic rule identifier from the playbook.
     * Examples: 'progression.closed_to_semi.fraction.general'
     *           'decree.indulto.2024_12_25.eligibility.violent'
     * Architecture ref: playbook-system.md §2.3.
     */
    ruleId: text('rule_id').notNull(),

    /**
     * The playbook version that contained this rule.
     * Required: execution-engine.md §8 (every conclusion must cite rule+version).
     */
    playbookVersionId: uuid('playbook_version_id').notNull(),

    /**
     * The rule group this rule belongs to (denormalized for filtering).
     * Examples: 'progression_fractions', 'hediondo_modifiers'
     */
    ruleGroupId: text('rule_group_id'),

    /**
     * The branch selected for this evaluation.
     * Null if the rule has no branches.
     */
    branchId: text('branch_id'),

    /**
     * The specific evaluator function invoked.
     * Maps rule type to engine evaluator code. Not legal logic itself.
     * Examples: 'progressionFraction', 'blockingCondition', 'decreeEligibility'
     */
    evaluatorId: text('evaluator_id').notNull(),

    // -------------------------------------------------------------------------
    // Evaluation sequence
    // -------------------------------------------------------------------------

    /**
     * Position in the ordered evaluation sequence for this run.
     * Deterministic ordering: ensures same rules execute in same order on replay.
     */
    evaluationOrder: integer('evaluation_order').notNull(),

    // -------------------------------------------------------------------------
    // Inputs and outputs (cryptographic provenance)
    // -------------------------------------------------------------------------

    /**
     * SHA-256 hash of the JSON-serialized rule inputs at evaluation time.
     * Includes: confirmed facts consumed, playbook parameters, branch parameters.
     * Replay: same inputsHash + same ruleId + same playbookVersionId → same outputsHash.
     */
    inputsHash: text('inputs_hash').notNull(),

    /**
     * SHA-256 hash of the JSON-serialized rule outputs.
     * Replay consistency check: outputsHash must match on re-execution.
     */
    outputsHash: text('outputs_hash').notNull(),

    /**
     * Full inputs consumed by this rule (for replay and debugging).
     * NOT stored for production performance — stored only for replay runs.
     * JSON: domain-specific per evaluatorId.
     */
    inputsSnapshot: jsonb('inputs_snapshot'),

    /**
     * Full outputs produced by this rule.
     * JSON: { eligible, earliestDate, blockingReasons, missingData, ... }
     */
    outputsSnapshot: jsonb('outputs_snapshot'),

    // -------------------------------------------------------------------------
    // Outcome
    // -------------------------------------------------------------------------

    outcome: ruleOutcomeEnum('outcome').notNull(),

    /**
     * Uncertainty level for this specific rule evaluation.
     * Architecture ref: execution-engine.md §5 (uncertainty model).
     */
    uncertaintyLevel: uncertaintyLevelEnum('uncertainty_level').notNull().default('none'),

    /**
     * Blocking codes active when this rule was evaluated (may be global or rule-level).
     * JSON: string[]
     */
    blockingCodes: jsonb('blocking_codes').notNull().default([]),

    /**
     * Uncertainty factors from execution-engine.md §5.1.
     * JSON: [{ code: string, message: string, affectedOutputs: string[] }]
     * Codes: 'CONFLICTING_CALCULATIONS', 'DISPUTED_DATES', 'INCOMPLETE_RECORDS',
     *        'PENDING_JUDICIAL_DECISION', 'DIVERGENT_INTERPRETATION'
     */
    uncertaintyFactors: jsonb('uncertainty_factors').notNull().default([]),

    /**
     * Missing data that affected this rule's output.
     * JSON: [{ field: string, whyNeeded: string, severity: 'critical'|'recommended'|'optional' }]
     */
    missingDataRefs: jsonb('missing_data_refs').notNull().default([]),

    // -------------------------------------------------------------------------
    // Timing
    // -------------------------------------------------------------------------

    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),

    /**
     * Execution duration in milliseconds. Used for performance monitoring.
     */
    durationMs: integer('duration_ms'),

    // -------------------------------------------------------------------------
    // NO updated_at, NO deleted_at — APPEND-ONLY
    // -------------------------------------------------------------------------
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * PRIMARY QUERY: all rule traces for an engine run.
     * pattern: WHERE engine_run_id = ? ORDER BY evaluation_order ASC
     */
    index('engine_rule_traces_run_order_idx').on(table.engineRunId, table.evaluationOrder),

    /**
     * RULE HISTORY: all evaluations of a specific rule across runs.
     * Enables: "how has rule X performed over time?"
     */
    index('engine_rule_traces_rule_idx').on(table.ruleId, table.playbookVersionId),

    index('engine_rule_traces_org_idx').on(table.organizationId),
  ]
)

export type EngineRuleTrace = typeof engineRuleTraces.$inferSelect
export type NewEngineRuleTrace = typeof engineRuleTraces.$inferInsert
