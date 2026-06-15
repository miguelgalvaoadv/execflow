/**
 * Evaluator registry — maps evaluatorId → pure evaluator function.
 *
 * The evaluator registry is the ONLY place where evaluator functions are
 * registered. The playbook references evaluators by evaluatorId; the engine
 * loads the appropriate function from this registry.
 *
 * EVALUATOR CONTRACT:
 * - Pure functions: same input → same output (deterministic).
 * - No side effects: no DB access, no I/O, no mutations.
 * - No hardcoded legal parameters: all parameters come from the playbook branch.
 * - Return RuleEvaluatorOutput (never throw for expected cases).
 *
 * ALLOWED in evaluators (the "grammar"):
 *   if (facts.servedDays / facts.totalSentenceDays >= parameters.requiredFraction)
 *
 * FORBIDDEN in evaluators:
 *   if (facts.servedDays / facts.totalSentenceDays >= 1/6)  // hardcoded fraction!
 *
 * Architecture ref: execution-engine.md §0 (engine principles),
 *                   playbook-system.md §9 (forbidden architecture).
 */

import type { RuleEvaluatorInput, RuleEvaluatorOutput } from '../types/index.ts'
import { lepProgressionFractionEvaluator } from '../evaluation/evaluators/lep-progression-evaluator.ts'
import { lepParoleFractionEvaluator } from '../evaluation/evaluators/lep-parole-evaluator.ts'
import { lepRemissionEvaluator } from '../evaluation/evaluators/lep-remission-evaluator.ts'
import { lepDetractionEvaluator } from '../evaluation/evaluators/lep-detraction-evaluator.ts'

export type RuleEvaluatorFn = (input: RuleEvaluatorInput) => RuleEvaluatorOutput

const registry = new Map<string, RuleEvaluatorFn>()

/**
 * Registers an evaluator function by its evaluatorId.
 * Called at engine startup; evaluatorIds must be unique.
 */
export function registerEvaluator(evaluatorId: string, fn: RuleEvaluatorFn): void {
  if (registry.has(evaluatorId)) {
    throw new Error(`Evaluator already registered: ${evaluatorId}`)
  }
  registry.set(evaluatorId, fn)
}

/**
 * Retrieves an evaluator by its ID.
 * Returns null if no evaluator is registered for this ID.
 */
export function getEvaluator(evaluatorId: string): RuleEvaluatorFn | null {
  return registry.get(evaluatorId) ?? null
}

/**
 * Returns all registered evaluator IDs (for diagnostics and validation).
 */
export function listRegisteredEvaluators(): string[] {
  return Array.from(registry.keys())
}

// ---------------------------------------------------------------------------
// Built-in evaluator: progressionFraction
// ---------------------------------------------------------------------------
// Evaluates whether a case meets the regime progression fraction threshold.
// Parameters come from the playbook branch — never hardcoded here.
// Architecture ref: execution-engine.md §3.1 (progression engine).

registerEvaluator('progressionFraction', (input): RuleEvaluatorOutput => {
  const { facts, parameters, ruleId, playbookVersionId, activeBlockingCodes } = input

  // Check global blocking conditions first
  const progressionBlockers = activeBlockingCodes.filter((code) =>
    ['BLK_ESCAPE', 'BLK_SNAPSHOT_UNCONFIRMED', 'BLK_UNIFICATION_PENDING'].includes(code)
  )
  if (progressionBlockers.length > 0) {
    return {
      outcome: 'opportunity_blocked',
      confidenceLevel: 'blocked',
      uncertaintyLevel: 'blocking',
      blockingCodes: progressionBlockers,
      uncertaintyFactors: [],
      missingData: [],
      legalRulesApplied: [],
      calculations: [],
    }
  }

  // Require sentence and custody facts
  if (facts.sentence === null) {
    return {
      outcome: 'insufficient_data',
      confidenceLevel: 'unknown',
      uncertaintyLevel: 'blocking',
      blockingCodes: [],
      uncertaintyFactors: [],
      missingData: [
        {
          field: 'sentence_snapshot',
          whyNeeded: 'Confirmed SentenceSnapshot required for fraction calculation',
          severity: 'critical',
        },
      ],
      legalRulesApplied: [],
      calculations: [],
    }
  }

  if (facts.custody === null) {
    return {
      outcome: 'insufficient_data',
      confidenceLevel: 'unknown',
      uncertaintyLevel: 'blocking',
      blockingCodes: [],
      uncertaintyFactors: [],
      missingData: [
        {
          field: 'custody_snapshot',
          whyNeeded: 'Confirmed CustodySnapshot required to determine current regime',
          severity: 'critical',
        },
      ],
      legalRulesApplied: [],
      calculations: [],
    }
  }

  // Check active progression interruptions
  const progressionInterruptions = facts.activeInterruptions.filter((i) =>
    i.type === 'progression' || i.type === 'all_liberty'
  )
  if (progressionInterruptions.length > 0) {
    return {
      outcome: 'opportunity_blocked',
      confidenceLevel: 'blocked',
      uncertaintyLevel: 'high',
      blockingCodes: ['BLK_INTERRUPTION_ACTIVE'],
      uncertaintyFactors: [
        {
          code: 'PENDING_JUDICIAL_DECISION',
          message: `Active progression interruption: ${progressionInterruptions[0]?.reason ?? 'unknown'}`,
          affectedOutputs: ['progression_eligibility'],
        },
      ],
      missingData: [],
      legalRulesApplied: [],
      calculations: [],
    }
  }

  // Extract playbook parameters — no hardcoded values
  const requiredFraction = parameters['requiredFraction'] as number | undefined
  const denominatorBasis = parameters['denominatorBasis'] as string | undefined
  const targetRegime = parameters['targetRegime'] as string | undefined

  if (requiredFraction === undefined || denominatorBasis === undefined) {
    return {
      outcome: 'insufficient_data',
      confidenceLevel: 'unknown',
      uncertaintyLevel: 'blocking',
      blockingCodes: ['BLK_PLAYBOOK_MISCONFIGURED'],
      uncertaintyFactors: [],
      missingData: [
        {
          field: 'playbook_parameters',
          whyNeeded: 'requiredFraction and denominatorBasis must be set in playbook rule',
          severity: 'critical',
        },
      ],
      legalRulesApplied: [],
      calculations: [],
    }
  }

  const sentence = facts.sentence
  const totalDays = sentence.totalSentenceDays
  if (totalDays === 0) {
    return {
      outcome: 'insufficient_data',
      confidenceLevel: 'unknown',
      uncertaintyLevel: 'blocking',
      blockingCodes: [],
      uncertaintyFactors: [],
      missingData: [
        {
          field: 'total_sentence_days',
          whyNeeded: 'Total sentence days must be > 0 for fraction calculation',
          severity: 'critical',
        },
      ],
      legalRulesApplied: [],
      calculations: [],
    }
  }

  // Compute fraction served — denominatorBasis determines numerator composition
  // Parameters control WHAT counts; evaluator provides the IF/THEN grammar
  const numerator = sentence.servedDays + sentence.remissionDays + sentence.detractionDays
  const fractionServed = numerator / totalDays
  const eligible = fractionServed >= requiredFraction

  // Propagate snapshot confidence to output
  const outputConfidence = sentence.confidenceLevel === 'high'
    ? 'high'
    : sentence.confidenceLevel === 'medium'
    ? 'medium'
    : 'low'

  return {
    outcome: eligible ? 'opportunity_suggested' : 'no_match',
    confidenceLevel: outputConfidence,
    uncertaintyLevel: outputConfidence === 'high' ? 'none' : outputConfidence === 'medium' ? 'low' : 'medium',
    blockingCodes: [],
    uncertaintyFactors: sentence.confidenceLevel !== 'high' ? [
      {
        code: 'INCOMPLETE_RECORDS',
        message: `Sentence snapshot confidence is '${sentence.confidenceLevel}' — calculation may be imprecise`,
        affectedOutputs: ['fraction_served', 'eligibility_date'],
      },
    ] : [],
    missingData: sentence.missingDataFlags.map((f) => ({
      field: f.field,
      whyNeeded: f.description,
      severity: f.impact === 'high' ? 'critical' as const : 'recommended' as const,
    })),
    legalRulesApplied: [
      {
        ruleId,
        playbookVersionId,
        branchId: null,
        citationRef: `playbook:${ruleId}@${playbookVersionId}`,
      },
    ],
    calculations: [
      {
        name: 'Fração cumprida',
        inputs: {
          diasCumpridos: sentence.servedDays,
          diasRemidos: sentence.remissionDays,
          diasDetração: sentence.detractionDays,
          penaTotalDias: totalDays,
          denominador: denominatorBasis,
        },
        output: `${(fractionServed * 100).toFixed(4)}% (limiar playbook: ${(requiredFraction * 100).toFixed(4)}%)`,
        confidence: outputConfidence,
        derivationNote: `Numerador: dias cumpridos + remição + detração. Denominador: ${denominatorBasis}. Parâmetros do playbook versão ${playbookVersionId}.`,
      },
    ],
    ...(eligible
      ? {
          opportunityProposal: {
            opportunityType: 'progression',
            summary: `Fração para ${targetRegime ?? 'progressão'} atingida (${(fractionServed * 100).toFixed(2)}%)`,
            rationale: `Fração cumprida (${(fractionServed * 100).toFixed(4)}%) ≥ limiar playbook (${(requiredFraction * 100).toFixed(4)}%)`,
            windowStartAt: null,
            windowEndAt: null,
            riskLevel: 'high' as const,
            requiresLawyerReview: true,
          },
        }
      : {}),
  }
})

// ---------------------------------------------------------------------------
// Built-in evaluator: blockingConditionCheck
// ---------------------------------------------------------------------------
// Emits a warning if a global blocking condition is active.

registerEvaluator('blockingConditionCheck', (input): RuleEvaluatorOutput => {
  const { activeBlockingCodes, ruleId, playbookVersionId } = input
  const parameters = input.parameters

  const targetCode = parameters['blockingCode'] as string | undefined
  if (targetCode === undefined) {
    return {
      outcome: 'no_match',
      confidenceLevel: 'high',
      uncertaintyLevel: 'none',
      blockingCodes: [],
      uncertaintyFactors: [],
      missingData: [],
      legalRulesApplied: [],
      calculations: [],
    }
  }

  if (activeBlockingCodes.includes(targetCode)) {
    return {
      outcome: 'warning',
      confidenceLevel: 'low',
      uncertaintyLevel: 'high',
      blockingCodes: [targetCode],
      uncertaintyFactors: [
        {
          code: 'PENDING_JUDICIAL_DECISION',
          message: `Blocking condition active: ${targetCode}`,
          affectedOutputs: ['all_liberty_opportunities'],
        },
      ],
      missingData: [],
      legalRulesApplied: [
        {
          ruleId,
          playbookVersionId,
          branchId: null,
          citationRef: `playbook:${ruleId}@${playbookVersionId}`,
        },
      ],
      calculations: [],
    }
  }

  return {
    outcome: 'no_match',
    confidenceLevel: 'high',
    uncertaintyLevel: 'none',
    blockingCodes: [],
    uncertaintyFactors: [],
    missingData: [],
    legalRulesApplied: [],
    calculations: [],
  }
})

// ---------------------------------------------------------------------------
// Built-in evaluator: snapshotStalenessCheck
// ---------------------------------------------------------------------------
// Emits a blocking warning when the confirmed snapshot is older than threshold.

registerEvaluator('snapshotStalenessCheck', (input): RuleEvaluatorOutput => {
  const { facts, ruleId, playbookVersionId } = input
  const parameters = input.parameters

  const maxDays = parameters['maxDays'] as number | undefined ?? 180

  if (!facts.hasRecentConfirmedSnapshot) {
    const daysSinceSnapshot = facts.sentence !== null
      ? Math.floor((facts.evaluatedAt.getTime() - facts.sentence.effectiveAt.getTime()) / (1000 * 60 * 60 * 24))
      : null

    return {
      outcome: 'warning',
      confidenceLevel: 'low',
      uncertaintyLevel: 'high',
      blockingCodes: ['BLK_SNAPSHOT_UNCONFIRMED'],
      uncertaintyFactors: [
        {
          code: 'STALE_DEPENDENCY',
          message: `SentenceSnapshot is older than ${maxDays} days (${daysSinceSnapshot !== null ? `${daysSinceSnapshot} days` : 'unknown'})`,
          affectedOutputs: ['all_arithmetic_outputs'],
        },
      ],
      missingData: [
        {
          field: 'confirmed_sentence_snapshot',
          whyNeeded: `A confirmed snapshot within ${maxDays} days is required for reliable evaluation`,
          severity: 'critical',
        },
      ],
      legalRulesApplied: [
        {
          ruleId,
          playbookVersionId,
          branchId: null,
          citationRef: `playbook:${ruleId}@${playbookVersionId}`,
        },
      ],
      calculations: [],
    }
  }

  return {
    outcome: 'no_match',
    confidenceLevel: 'high',
    uncertaintyLevel: 'none',
    blockingCodes: [],
    uncertaintyFactors: [],
    missingData: [],
    legalRulesApplied: [],
    calculations: [],
  }
})

// ---------------------------------------------------------------------------
// Built-in evaluator: lepProgressionFraction (LEP Art. 112)
// ---------------------------------------------------------------------------
// Evaluates regime progression eligibility per crime using LEP fraction table.
// Fractions (16%-70%) come from playbook parameters, never hardcoded.

registerEvaluator('lepProgressionFraction', lepProgressionFractionEvaluator)

// ---------------------------------------------------------------------------
// Built-in evaluator: lepParoleFraction (CP Art. 83)
// ---------------------------------------------------------------------------
// Evaluates conditional parole eligibility (1/3, 1/2, 2/3 or prohibited).
// Includes minimum sentence check (2 years) and subjective requirements.

registerEvaluator('lepParoleFraction', lepParoleFractionEvaluator)

// ---------------------------------------------------------------------------
// Built-in evaluator: lepRemission (LEP Art. 126-130)
// ---------------------------------------------------------------------------
// Evaluates remission impact (work 3:1, study 12h:1, reading 4d/book).
// Generates informational opportunity when remission affects eligibility dates.

registerEvaluator('lepRemission', lepRemissionEvaluator)

// ---------------------------------------------------------------------------
// Built-in evaluator: lepDetraction (CP Art. 42)
// ---------------------------------------------------------------------------
// Evaluates pre-trial detention time credit against the sentence.

registerEvaluator('lepDetraction', lepDetractionEvaluator)
