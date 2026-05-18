/**
 * Opportunity evaluator — iterates over playbook rules and evaluates each.
 *
 * This is the main evaluation loop. For each rule group and rule in the
 * resolved playbook, it:
 * 1. Looks up the registered evaluator function
 * 2. Constructs the RuleEvaluatorInput (confirmed facts + playbook parameters)
 * 3. Invokes the pure evaluator function (no DB writes)
 * 4. Records the trace
 *
 * DETERMINISM GUARANTEE:
 * - Rules are evaluated in a stable, deterministic order (evaluation_order).
 * - Same playbook + same facts → same outputs on every execution.
 * - Evaluator registry maps to pure functions only.
 *
 * Architecture ref: execution-engine.md §4 (opportunity computation pipeline).
 */

import { createHash } from 'crypto'
import type {
  EvaluationContext,
  RuleEvaluatorInput,
  RuleEvaluatorOutput,
  EngineRunResult,
  UncertaintyLevel,
  ExplanationBundlePayload,
  ConfidenceLevel,
} from '../types/index.ts'
import { getEvaluator } from '../rules/registry.ts'
import { aggregateConfidence, aggregateUncertainty } from '../rules/confidence.ts'
import { isOpportunityBlocked } from './blocking.ts'
import { mergeUncertaintyFactors } from '../uncertainty/model.ts'

type RuleTrace = EngineRunResult['ruleTraces'][number]
type OpportunityProposal = EngineRunResult['opportunityProposals'][number]

/**
 * Evaluates all rules in the resolved playbook against the case facts.
 * Returns the evaluation result WITHOUT writing to the database.
 *
 * The caller (runtime/runner.ts) passes this result to commit.ts for persistence.
 */
export function evaluateOpportunities(ctx: EvaluationContext): {
  ruleTraces: RuleTrace[]
  opportunityProposals: OpportunityProposal[]
  warnings: EngineRunResult['warnings']
  allConfidenceLevels: ConfidenceLevel[]
  allUncertaintyLevels: UncertaintyLevel[]
} {
  const ruleTraces: RuleTrace[] = []
  const opportunityProposals: OpportunityProposal[] = []
  const warnings: EngineRunResult['warnings'] = []
  const allConfidenceLevels: ConfidenceLevel[] = []
  const allUncertaintyLevels: UncertaintyLevel[] = []

  const activeBlockingCodes = ctx.globalBlockingCodes.map((b) => b.code)

  let evaluationOrder = 0

  // Iterate rules in deterministic order: groups in order, rules in order within group
  for (const group of ctx.playbook.groups) {
    for (const rule of group.rules) {
      const resolvedEntry = ctx.playbook.ruleMap.get(rule.ruleId)
      if (resolvedEntry === undefined) continue // rule not in resolved map (no branch)

      const { branch } = resolvedEntry

      // Look up the evaluator function
      const evaluatorFn = getEvaluator(rule.evaluatorId)
      if (evaluatorFn === null) {
        // Unknown evaluator — emit warning, do not fail the run
        warnings.push({
          code: 'EVALUATOR_NOT_FOUND',
          message: `No evaluator registered for '${rule.evaluatorId}' (rule: ${rule.ruleId})`,
          ruleId: rule.ruleId,
        })
        evaluationOrder++
        continue
      }

      // Build pure evaluator input
      const evalInput: RuleEvaluatorInput = {
        ruleId: rule.ruleId,
        evaluatorId: rule.evaluatorId,
        parameters: branch.parameters,
        facts: ctx.facts,
        playbookVersionId: ctx.playbook.playbookVersionId,
        activeBlockingCodes,
      }

      // Invoke pure function (no side effects inside)
      const startedAt = new Date()
      let output: RuleEvaluatorOutput
      try {
        output = evaluatorFn(evalInput)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        warnings.push({
          code: 'EVALUATOR_ERROR',
          message: `Evaluator '${rule.evaluatorId}' threw: ${errorMsg}`,
          ruleId: rule.ruleId,
        })
        evaluationOrder++
        continue
      }
      const completedAt = new Date()
      const durationMs = completedAt.getTime() - startedAt.getTime()

      // Hash inputs and outputs for replay consistency checks
      const inputsHash = hashJson(evalInput.parameters)
      const outputsHash = hashJson({
        outcome: output.outcome,
        confidenceLevel: output.confidenceLevel,
        blockingCodes: output.blockingCodes,
      })

      // Build rule trace
      const trace: RuleTrace = {
        ruleId: rule.ruleId,
        playbookVersionId: ctx.playbook.playbookVersionId,
        evaluatorId: rule.evaluatorId,
        evaluationOrder,
        inputsHash,
        outputsHash,
        outcome: output.outcome,
        uncertaintyLevel: output.uncertaintyLevel,
        blockingCodes: output.blockingCodes,
        uncertaintyFactors: output.uncertaintyFactors,
        missingDataRefs: output.missingData,
        startedAt,
        completedAt,
        durationMs,
      }

      ruleTraces.push(trace)
      allConfidenceLevels.push(output.confidenceLevel)
      allUncertaintyLevels.push(output.uncertaintyLevel)

      // Emit warnings
      if (output.outcome === 'warning') {
        warnings.push({
          code: output.blockingCodes[0] ?? 'ENGINE_WARNING',
          message: output.uncertaintyFactors[0]?.message ?? `Warning from rule ${rule.ruleId}`,
          ruleId: rule.ruleId,
        })
      }

      // Create opportunity proposal if rule suggests one
      if (
        output.outcome === 'opportunity_suggested' &&
        output.opportunityProposal !== undefined
      ) {
        const proposal = output.opportunityProposal

        // Final blocking check (engine cannot auto-suggest blocked types)
        const blocking = ctx.globalBlockingCodes.map((b) => ({
          hasGlobalBlock: b.severity === 'full',
          activeCodes: ctx.globalBlockingCodes,
          fullBlockCodes: ctx.globalBlockingCodes.filter((c) => c.severity === 'full').map((c) => c.code),
          partialBlockCodes: ctx.globalBlockingCodes.filter((c) => c.severity === 'partial').map((c) => c.code),
        }))[0] ?? { hasGlobalBlock: false, activeCodes: [], fullBlockCodes: [], partialBlockCodes: [] }

        if (!isOpportunityBlocked(proposal.opportunityType, blocking)) {
          const explanationBundle = buildExplanationBundle(ctx, output, rule.ruleId)

          opportunityProposals.push({
            ruleId: rule.ruleId,
            opportunityType: proposal.opportunityType,
            summary: proposal.summary,
            rationale: proposal.rationale,
            confidenceLevel: output.confidenceLevel,
            windowStartAt: proposal.windowStartAt,
            windowEndAt: proposal.windowEndAt,
            riskLevel: proposal.riskLevel,
            requiresLawyerReview: proposal.requiresLawyerReview,
            explanationBundle,
          })
        }
      }

      evaluationOrder++
    }
  }

  return {
    ruleTraces,
    opportunityProposals,
    warnings,
    allConfidenceLevels,
    allUncertaintyLevels,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hashJson(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value, Object.keys(value as object).sort()))
    .digest('hex')
    .slice(0, 16) // short hash for storage efficiency
}

function buildExplanationBundle(
  ctx: EvaluationContext,
  output: RuleEvaluatorOutput,
  ruleId: string
): ExplanationBundlePayload {
  return {
    summary: output.opportunityProposal?.summary ?? `Rule ${ruleId} evaluation`,
    conclusionType: 'opportunity',
    playbookVersion: {
      id: ctx.playbook.playbookVersionId,
      label: ctx.playbook.playbookVersionId, // full label loaded from DB in loader
      effectiveFrom: ctx.playbook.effectiveAt.toISOString(),
    },
    legalRulesApplied: output.legalRulesApplied.map((r) => ({
      ...r,
      parameters: ctx.playbook.ruleMap.get(r.ruleId)?.branch.parameters ?? {},
    })),
    calculations: output.calculations,
    sourceDocuments: [],
    sourceEvents: ctx.facts.recentEvents.slice(0, 5).map((e) => ({
      timelineEventId: e.eventId,
      eventType: e.eventType,
    })),
    missingData: output.missingData,
    uncertaintyIndicators: output.uncertaintyFactors,
    blockingCodes: output.blockingCodes,
    alternatives: output.alternatives ?? [],
  }
}
