/**
 * Engine and playbook PostgreSQL enum types for EXECFLOW Phase 7.
 *
 * These enums model the computation engine lifecycle, playbook governance,
 * and legal evaluation states. All engine outputs are non-binding candidates
 * until confirmed by a human actor.
 *
 * Architecture ref: execution-engine.md §0, playbook-system.md §4,
 *                   functional-architecture.md §6.
 */

import { pgEnum } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Playbook governance
// ---------------------------------------------------------------------------

/**
 * Playbook version lifecycle — mirrors playbook-system.md §4.1.
 *
 * draft     → Being authored; editable by creator.
 * review    → Submitted for dual review; locked for author.
 * published → Frozen; selected by engine for new runs.
 * retired   → Frozen; not selected for new runs; historical replay only.
 *
 * Publish action requires: validation suite, legal sign-off, content hash.
 * NEVER modify rule values after publish — create a new version instead.
 */
export const playbookStatusEnum = pgEnum('playbook_status', [
  'draft',
  'review',
  'published',
  'retired',
])

/**
 * Strategy profile — office interpretation policy per playbook-system.md §5.3.
 *
 * conservative → Prefer branches that delay suggestions; higher caution.
 * standard     → Default branches; majority jurisprudence.
 * aggressive   → Earlier eligibility windows where legally arguable; elevated warnings.
 *
 * Strategy affects suggestion timing, NOT approval gates. Lawyers always qualify.
 */
export const strategyProfileEnum = pgEnum('strategy_profile', [
  'conservative',
  'standard',
  'aggressive',
])

// ---------------------------------------------------------------------------
// Engine run
// ---------------------------------------------------------------------------

/**
 * EngineRun lifecycle — execution-engine.md §9.
 *
 * running   → Evaluation in progress (transient; should not persist long).
 * completed → Evaluation finished; outputs committed.
 * failed    → Evaluation error; partial outputs NOT committed.
 * superseded→ Superseded by a newer run for the same case; retained for replay.
 */
export const engineRunStatusEnum = pgEnum('engine_run_status', [
  'running',
  'completed',
  'failed',
  'superseded',
])

/**
 * What triggered an engine evaluation — for audit and replay context.
 *
 * manual                → Lawyer or admin explicitly requested evaluation.
 * timeline_event        → A TimelineEvent was appended to the case.
 * snapshot_superseded   → A SentenceSnapshot was superseded (triggers recalculation).
 * custody_snapshot      → A new CustodySnapshot was created.
 * document_associated   → A confirmed document was associated to the case.
 * playbook_published    → A new playbook version published; migration re-evaluation.
 * recalculation         → Cascading recalculation from a prior engine run.
 * scheduled             → Periodic sweep (e.g., daily SLA check).
 */
export const engineRunTriggerEnum = pgEnum('engine_run_trigger', [
  'manual',
  'timeline_event',
  'snapshot_superseded',
  'custody_snapshot',
  'document_associated',
  'playbook_published',
  'recalculation',
  'scheduled',
])

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

/**
 * Output of a single rule evaluation — execution-engine.md §4.3.
 *
 * opportunity_suggested → Rule passed; created Opportunity candidate.
 * opportunity_blocked   → Blocking condition prevents suggestion.
 * insufficient_data     → Required inputs missing; no output created.
 * warning               → Non-blocking issue; EngineWarning emitted.
 * snapshot_proposal     → Rule proposes a new SentenceSnapshot.
 * no_match              → Rule evaluated but case does not match criteria.
 */
export const ruleOutcomeEnum = pgEnum('rule_outcome', [
  'opportunity_suggested',
  'opportunity_blocked',
  'insufficient_data',
  'warning',
  'snapshot_proposal',
  'no_match',
])

/**
 * Uncertainty level for engine outputs — execution-engine.md §5.
 *
 * none     → No uncertainty; output is deterministic from confirmed inputs.
 * low      → Minor missing optional data; output still reliable.
 * medium   → Significant gaps; low-confidence output acceptable.
 * high     → Major conflicts or missing critical data; output unreliable.
 * blocking → Uncertainty prevents output creation entirely.
 */
export const uncertaintyLevelEnum = pgEnum('uncertainty_level', [
  'none',
  'low',
  'medium',
  'high',
  'blocking',
])

// ---------------------------------------------------------------------------
// Snapshot dependency
// ---------------------------------------------------------------------------

/**
 * Type of dependency tracked in snapshot_dependencies.
 *
 * sentence_snapshot → EngineRun depended on this SentenceSnapshot.
 * custody_snapshot  → EngineRun depended on this CustodySnapshot.
 * timeline_event    → EngineRun depended on this TimelineEvent.
 * document          → EngineRun depended on this confirmed Document.
 * playbook_version  → EngineRun used this PlaybookVersion.
 */
export const snapshotDependencyTypeEnum = pgEnum('snapshot_dependency_type', [
  'sentence_snapshot',
  'custody_snapshot',
  'timeline_event',
  'document',
  'playbook_version',
])

// ---------------------------------------------------------------------------
// Recalculation run
// ---------------------------------------------------------------------------

/**
 * RecalculationRun lifecycle — tracks cascading recalculation chains.
 *
 * scheduled  → Recalculation queued but not yet started.
 * running    → Recalculation in progress.
 * completed  → Recalculation finished; new engine run committed.
 * failed     → Recalculation failed; case marked for manual review.
 * skipped    → Recalculation determined unnecessary (no material change).
 */
export const recalculationRunStatusEnum = pgEnum('recalculation_run_status', [
  'scheduled',
  'running',
  'completed',
  'failed',
  'skipped',
])
