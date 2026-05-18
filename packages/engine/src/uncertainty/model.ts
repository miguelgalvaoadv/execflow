/**
 * Uncertainty model — propagation and resolution.
 *
 * Uncertainty is FIRST-CLASS STATE in the engine. Never collapse ambiguity
 * into a single value when the inputs are contested or incomplete.
 *
 * Architecture ref: execution-engine.md §5 (legal uncertainty model).
 */

import type {
  CaseFacts,
  UncertaintyFactor,
  GlobalBlockingCode,
  ConfidenceLevel,
  UncertaintyLevel,
} from '../types/index.ts'
import { aggregateUncertainty } from '../rules/confidence.ts'

/**
 * Derives the global blocking codes from the current case facts.
 * These codes suppress all liberty-affecting opportunity suggestions.
 * Architecture ref: execution-engine.md §4.2.
 */
export function deriveGlobalBlockingCodes(facts: CaseFacts): GlobalBlockingCode[] {
  const codes: GlobalBlockingCode[] = []

  // BLK_ESCAPE — escape interruption active
  const escapeInterruption = facts.activeInterruptions.find(
    (i) => i.type === 'all_liberty' && i.reason.toLowerCase().includes('fug')
  )
  if (escapeInterruption !== undefined) {
    codes.push({
      code: 'BLK_ESCAPE',
      reason: `Escape interruption active since ${escapeInterruption.since.toISOString()}`,
      severity: 'full',
    })
  }

  // BLK_SNAPSHOT_UNCONFIRMED — no confirmed snapshot within threshold
  if (!facts.hasRecentConfirmedSnapshot) {
    codes.push({
      code: 'BLK_SNAPSHOT_UNCONFIRMED',
      reason: 'No confirmed SentenceSnapshot within the required period',
      severity: 'full',
    })
  }

  // BLK_PROCESS_PENDING — no confirmed process number
  if (!facts.hasConfirmedProcessNumber) {
    codes.push({
      code: 'BLK_PROCESS_PENDING',
      reason: 'Execution process number is pending',
      severity: 'partial',
    })
  }

  // BLK_UNIFICATION_PENDING — multiple active sentence lines without unified snapshot
  // (This would need more specific data; placeholder for future phase)

  return codes
}

/**
 * Aggregates uncertainty factors from multiple rule outputs.
 * Deduplicates by code + message to avoid noisy repetition.
 */
export function mergeUncertaintyFactors(
  factorSets: UncertaintyFactor[][]
): UncertaintyFactor[] {
  const seen = new Set<string>()
  const result: UncertaintyFactor[] = []

  for (const factors of factorSets) {
    for (const factor of factors) {
      const key = `${factor.code}:${factor.message}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push(factor)
      }
    }
  }

  return result
}

/**
 * Computes the overall uncertainty level from a case's facts before evaluation.
 * Used to set expectations before any rule runs.
 */
export function assessBaselineUncertainty(facts: CaseFacts): {
  level: UncertaintyLevel
  factors: UncertaintyFactor[]
} {
  const factors: UncertaintyFactor[] = []
  const levels: UncertaintyLevel[] = []

  if (facts.sentence === null) {
    factors.push({
      code: 'INCOMPLETE_RECORDS',
      message: 'No confirmed SentenceSnapshot available',
      affectedOutputs: ['all_arithmetic_outputs'],
    })
    levels.push('blocking')
  } else if (facts.sentence.confidenceLevel === 'low') {
    factors.push({
      code: 'INCOMPLETE_RECORDS',
      message: 'SentenceSnapshot confidence is low — significant missing data',
      affectedOutputs: ['fraction_served', 'remaining_days'],
    })
    levels.push('high')
  } else if (facts.sentence.confidenceLevel === 'unknown') {
    factors.push({
      code: 'INCOMPLETE_RECORDS',
      message: 'SentenceSnapshot has unknown confidence',
      affectedOutputs: ['all_arithmetic_outputs'],
    })
    levels.push('high')
  }

  if (facts.custody === null) {
    factors.push({
      code: 'INCOMPLETE_RECORDS',
      message: 'No confirmed CustodySnapshot available',
      affectedOutputs: ['regime_eligibility', 'progression_track'],
    })
    levels.push('high')
  }

  if (facts.activeInterruptions.length > 0) {
    factors.push({
      code: 'PENDING_JUDICIAL_DECISION',
      message: `${facts.activeInterruptions.length} active interruption(s) affecting benefit eligibility`,
      affectedOutputs: ['progression', 'livramento', 'liberty_opportunities'],
    })
    levels.push('medium')
  }

  return {
    level: aggregateUncertainty(levels.length > 0 ? levels : ['none']),
    factors,
  }
}

/**
 * Checks whether an uncertainty level prevents creating an opportunity.
 * Architecture ref: execution-engine.md §5.3 (blocked automations).
 */
export function isUncertaintyBlocking(
  level: UncertaintyLevel,
  opportunityType: string
): boolean {
  if (level === 'blocking') return true

  // High-risk opportunity types are blocked at 'high' uncertainty
  const criticalTypes = ['progression', 'excess_execution', 'detraction', 'hc']
  if (criticalTypes.includes(opportunityType) && level === 'high') return true

  return false
}

/**
 * Determines if confidence is sufficient to suggest an opportunity.
 * Engine NEVER auto-dismisses; this controls auto-suggestion only.
 * Architecture ref: execution-engine.md §5.3 ('Auto-dismiss opportunity': NEVER).
 */
export function canSuggest(
  confidence: ConfidenceLevel,
  opportunityType: string
): boolean {
  if (confidence === 'blocked' || confidence === 'unknown') return false

  // For high-risk types, require at least medium confidence
  const highRiskTypes = ['progression', 'excess_execution', 'hc', 'detraction']
  if (highRiskTypes.includes(opportunityType)) {
    return confidence === 'high' || confidence === 'medium'
  }

  return true
}
