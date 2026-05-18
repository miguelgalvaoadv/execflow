/**
 * Engine runner — main orchestrator for legal computation evaluation.
 *
 * The runner implements the full evaluation pipeline:
 * 1. Resolve applicable playbook version at evaluatedAt
 * 2. Load playbook (base + overlay + case context)
 * 3. Load confirmed case facts (snapshots, events)
 * 4. Derive baseline uncertainty and global blocking codes
 * 5. Evaluate all rules (pure, no DB writes)
 * 6. Generate ExplanationBundles
 * 7. Build EngineRunResult (NOT yet committed to DB)
 *
 * The commit step is separated from the evaluation step to maintain
 * the pure/deterministic character of the evaluator layer. The runner
 * is side-effect-free except for DB reads.
 *
 * Callers pass the result to runtime/commit.ts for DB persistence.
 *
 * Architecture ref: execution-engine.md §4 (opportunity computation pipeline).
 */

import { randomUUID } from 'crypto'
import type { AnyDbClient } from '@execflow/db/client'
import type {
  EvaluationContext,
  EngineRunResult,
  ConfidenceLevel,
  UncertaintyLevel,
} from '../types/index.ts'
import { resolvePlaybookVersions } from '../playbooks/resolver.ts'
import { loadPlaybook } from '../playbooks/loader.ts'
import { loadCaseFacts } from '../snapshots/loader.ts'
import { buildDependencies } from '../snapshots/dependency-tracker.ts'
import { evaluateGlobalBlocking } from '../evaluation/blocking.ts'
import { evaluateOpportunities } from '../evaluation/opportunity-evaluator.ts'
import { assessBaselineUncertainty } from '../uncertainty/model.ts'
import { aggregateConfidence, aggregateUncertainty } from '../rules/confidence.ts'

export type RunEvaluationInput = {
  runId?: string | undefined
  organizationId: string
  executionCaseId: string
  evaluatedAt: Date
  jurisdictionScope: string
  trigger: string
  isReplay?: boolean | undefined
}

/**
 * Runs the full legal computation evaluation for a case.
 *
 * Returns an EngineRunResult (not persisted yet).
 * Pass to runtime/commit.ts to persist to database.
 *
 * SIDE EFFECTS: DB reads only. No writes inside this function.
 */
export async function runEvaluation(
  db: AnyDbClient,
  input: RunEvaluationInput
): Promise<EngineRunResult> {
  const runId = input.runId ?? randomUUID()
  const { organizationId, executionCaseId, evaluatedAt, jurisdictionScope } = input

  // Step 1: Resolve applicable playbook version
  const resolution = await resolvePlaybookVersions(db, {
    organizationId,
    jurisdictionScope,
    evaluatedAt,
  })

  if (!resolution.found) {
    throw new Error(`Cannot run evaluation: ${resolution.reason}`)
  }

  // Step 2: Load merged playbook
  const playbook = await loadPlaybook(db, {
    organizationId,
    baseVersionId: resolution.baseVersionId,
    overlayVersionId: resolution.overlayVersionId,
    executionCaseId,
    strategyProfile: resolution.strategyProfile,
    evaluatedAt,
  })

  // Step 3: Load confirmed case facts
  const facts = await loadCaseFacts(db, {
    organizationId,
    executionCaseId,
    evaluatedAt,
  })

  // Step 4: Assess baseline uncertainty
  const baseline = assessBaselineUncertainty(facts)

  // Step 5: Evaluate global blocking conditions
  const blocking = evaluateGlobalBlocking(facts)

  // Step 6: Build evaluation context (immutable from here on)
  const ctx: EvaluationContext = {
    runId,
    organizationId,
    executionCaseId,
    evaluatedAt,
    playbook,
    facts,
    globalBlockingCodes: blocking.activeCodes,
  }

  // Step 7: Evaluate all rules (pure functions, no DB writes)
  const evaluation = evaluateOpportunities(ctx)

  // Step 8: Aggregate confidence and uncertainty
  const allConfidenceLevels: ConfidenceLevel[] = [
    ...evaluation.allConfidenceLevels,
    ...baseline.factors.map(() => 'low' as ConfidenceLevel),
  ]
  const allUncertaintyLevels: UncertaintyLevel[] = [
    baseline.level,
    ...evaluation.allUncertaintyLevels,
  ]

  const overallConfidence = aggregateConfidence(
    allConfidenceLevels.length > 0 ? allConfidenceLevels : ['unknown']
  )
  const overallUncertaintyLevel = aggregateUncertainty(allUncertaintyLevels)

  // Step 9: Collect all missing data
  const missingDataSummary = deduplicateMissingData(
    evaluation.ruleTraces.flatMap((t) => t.missingDataRefs)
  )

  // Step 10: Build dependencies for staleness tracking
  const dependencies = buildDependencies(facts, playbook)

  return {
    runId,
    organizationId,
    executionCaseId,
    playbookVersionId: playbook.playbookVersionId,
    evaluatedAt,
    overallConfidence,
    overallUncertaintyLevel,
    globalBlockingCodes: blocking.activeCodes.map((c) => c.code),
    missingDataSummary,
    ruleTraces: evaluation.ruleTraces,
    opportunityProposals: evaluation.opportunityProposals,
    warnings: evaluation.warnings,
    dependencies,
  }
}

/**
 * Runs a recalculation evaluation for a case (same as runEvaluation,
 * but called from a RecalculationRun context with additional metadata).
 */
export async function runRecalculation(
  db: AnyDbClient,
  input: RunEvaluationInput & {
    recalculationRunId: string
    parentRecalculationRunId: string | null
    chainDepth: number
  }
): Promise<EngineRunResult> {
  return runEvaluation(db, {
    ...input,
    trigger: 'recalculation',
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateMissingData(
  items: EngineRunResult['missingDataSummary']
): EngineRunResult['missingDataSummary'] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.field
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
