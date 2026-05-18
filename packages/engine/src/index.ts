/**
 * @execflow/engine — Legal computation engine public API.
 *
 * This package provides the deterministic legal evaluation engine for EXECFLOW.
 * It is a pure computation library: it reads from the database, evaluates
 * legal rules from playbooks, and returns results for the caller to persist.
 *
 * ARCHITECTURE BOUNDARIES:
 * - Engine reads DB (confirmed facts, playbook versions)
 * - Engine does NOT write DB inside rule evaluation (pure evaluators)
 * - Engine writes DB via commit.ts (after evaluation completes)
 * - Workers import engine functions and call them from event consumers
 *
 * FORBIDDEN IN THIS PACKAGE:
 * - Hardcoded legal fractions or parameters (all come from playbooks)
 * - LLM/AI calls (deterministic engine only)
 * - Direct HTTP calls
 * - Non-deterministic behavior (must replay identically)
 *
 * Architecture ref: execution-engine.md, playbook-system.md.
 */

// Orchestration services (primary public API)
export { runEvaluation, runRecalculation } from './runtime/runner.ts'
export { commitEngineRun, failEngineRun } from './runtime/commit.ts'

// Dependency invalidation
export { invalidateDependencies, hasStaleDependencies } from './snapshots/staleness.ts'

// Recalculation propagation
export {
  scheduleRecalculation,
  startRecalculation,
  completeRecalculation,
  failRecalculation,
} from './propagation/recalculation.ts'

// Explanation generation
export { generateRunExplanation, generateOpportunityExplanation } from './explanations/generator.ts'

// Historical replay
export { replayAtPointInTime } from './replay/point-in-time.ts'

// Playbook loading (for admin/validation use)
export { resolvePlaybookVersions } from './playbooks/resolver.ts'
export { loadPlaybook } from './playbooks/loader.ts'

// Evaluator registry (for extension by future phases)
export { registerEvaluator, listRegisteredEvaluators } from './rules/registry.ts'

// Type exports
export type {
  ConfidenceLevel,
  UncertaintyLevel,
  UncertaintyFactor,
  MissingDataItem,
  CaseFacts,
  SentenceFacts,
  CustodyFacts,
  ActiveInterruption,
  RelevantTimelineEvent,
  PlaybookRule,
  PlaybookRuleGroup,
  PlaybookBranch,
  ResolvedPlaybook,
  RuleEvaluatorInput,
  RuleEvaluatorOutput,
  EvaluationContext,
  ExplanationBundlePayload,
  EngineRunResult,
  ReplayRequest,
  ReplayBundle,
  RecalculationRequest,
  GlobalBlockingCode,
} from './types/index.ts'
