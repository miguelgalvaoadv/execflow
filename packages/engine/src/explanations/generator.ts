/**
 * ExplanationBundle generator — produces structured legal explanations.
 *
 * The generator assembles ExplanationBundle objects from:
 * - Rule evaluation outputs (legalRulesApplied, calculations)
 * - Case facts (source events, documents)
 * - Uncertainty indicators from the evaluation
 * - Missing data catalog
 *
 * DETERMINISM: the generator MUST produce deterministic output for the same
 * inputs. Sorting is applied to all arrays where order would otherwise be
 * non-deterministic. This enables replay consistency checks.
 *
 * Architecture ref: execution-engine.md §8 (explainability mandate).
 */

import type {
  ExplanationBundlePayload,
  EngineRunResult,
  EvaluationContext,
} from '../types/index.ts'

/**
 * Generates the run-level ExplanationBundle summarizing the full evaluation.
 * Attached to the EngineRun record itself (not individual opportunities).
 */
export function generateRunExplanation(
  ctx: EvaluationContext,
  result: EngineRunResult
): ExplanationBundlePayload {
  const opportunitySummary = result.opportunityProposals.length > 0
    ? `${result.opportunityProposals.length} oportunidade(s) identificada(s): ${result.opportunityProposals.map((o) => o.opportunityType).join(', ')}`
    : 'Nenhuma oportunidade identificada nesta avaliação'

  const warningSummary = result.warnings.length > 0
    ? ` ${result.warnings.length} aviso(s) emitido(s).`
    : ''

  const blockingSummary = result.globalBlockingCodes.length > 0
    ? ` Bloqueios ativos: ${result.globalBlockingCodes.join(', ')}.`
    : ''

  // Collect all rule IDs applied across traces
  const allRuleIds = [...new Set(
    result.ruleTraces
      .filter((t) => t.outcome !== 'no_match' && t.outcome !== 'insufficient_data')
      .map((t) => t.ruleId)
  )].sort()

  // Collect all uncertainty factors (deduplicated, sorted for determinism)
  const allUncertaintyFactors = deduplicateAndSort(
    result.ruleTraces.flatMap((t) => t.uncertaintyFactors),
    (f) => `${f.code}:${f.message}`
  )

  // Collect all missing data items (deduplicated, sorted)
  const allMissingData = deduplicateAndSort(
    result.ruleTraces.flatMap((t) => t.missingDataRefs),
    (m) => `${m.field}:${m.severity}`
  )

  return {
    summary: `${opportunitySummary}.${warningSummary}${blockingSummary}`,
    conclusionType: 'opportunity',
    playbookVersion: {
      id: ctx.playbook.playbookVersionId,
      label: ctx.playbook.playbookVersionId,
      effectiveFrom: ctx.playbook.effectiveAt.toISOString(),
    },
    legalRulesApplied: allRuleIds.map((ruleId) => ({
      ruleId,
      playbookVersionId: ctx.playbook.playbookVersionId,
      branchId: ctx.playbook.ruleMap.get(ruleId)?.branch.branchId ?? null,
      citationRef: `playbook:${ruleId}@${ctx.playbook.playbookVersionId}`,
      parameters: ctx.playbook.ruleMap.get(ruleId)?.branch.parameters ?? {},
    })),
    calculations: [],
    sourceDocuments: [],
    sourceEvents: ctx.facts.recentEvents.slice(0, 3).map((e) => ({
      timelineEventId: e.eventId,
      eventType: e.eventType,
    })),
    missingData: allMissingData,
    uncertaintyIndicators: allUncertaintyFactors,
    blockingCodes: result.globalBlockingCodes,
    alternatives: [],
  }
}

/**
 * Generates an ExplanationBundle for a specific opportunity proposal.
 * More detailed than the run-level explanation.
 */
export function generateOpportunityExplanation(
  ctx: EvaluationContext,
  proposal: EngineRunResult['opportunityProposals'][number]
): ExplanationBundlePayload {
  return {
    ...proposal.explanationBundle,
    summary: buildOpportunitySummary(proposal, ctx),
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildOpportunitySummary(
  proposal: EngineRunResult['opportunityProposals'][number],
  ctx: EvaluationContext
): string {
  const confidenceLabel =
    proposal.confidenceLevel === 'high'
      ? 'alta confiança'
      : proposal.confidenceLevel === 'medium'
      ? 'confiança média'
      : 'baixa confiança'

  const reviewNote = proposal.requiresLawyerReview
    ? ' Requer qualificação pelo advogado antes de prosseguir.'
    : ''

  return `${proposal.summary} (${confidenceLabel}). Playbook: ${ctx.playbook.playbookVersionId}.${reviewNote}`
}

function deduplicateAndSort<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = keyFn(item)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result.sort((a, b) => keyFn(a).localeCompare(keyFn(b)))
}
