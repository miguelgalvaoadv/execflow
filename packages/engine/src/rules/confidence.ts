/**
 * Confidence aggregation for engine outputs.
 *
 * COMPOSITION RULE (execution-engine.md §5.2):
 * Aggregate confidence = MINIMUM of all critical-path fields (weakest link).
 * A single low-confidence input propagates downward to the final output.
 *
 * This is a conservative, legally-safe design: we never inflate confidence
 * when any input component is uncertain.
 */

import type { ConfidenceLevel, UncertaintyLevel } from '../types/index.ts'

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  high: 4,
  medium: 3,
  low: 2,
  unknown: 1,
  blocked: 0,
}

const UNCERTAINTY_RANK: Record<UncertaintyLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocking: 4,
}

/**
 * Aggregate multiple confidence levels using the weakest-link rule.
 * Returns the minimum confidence across all inputs.
 * Architecture ref: execution-engine.md §5.2.
 */
export function aggregateConfidence(levels: ConfidenceLevel[]): ConfidenceLevel {
  if (levels.length === 0) return 'unknown'

  let minRank = CONFIDENCE_RANK['high']!
  let minLevel: ConfidenceLevel = 'high'

  for (const level of levels) {
    const rank = CONFIDENCE_RANK[level]
    if (rank !== undefined && rank < minRank) {
      minRank = rank
      minLevel = level
    }
  }

  return minLevel
}

/**
 * Aggregate uncertainty levels using worst-case (maximum) rule.
 * Returns the highest uncertainty across all inputs.
 */
export function aggregateUncertainty(levels: UncertaintyLevel[]): UncertaintyLevel {
  if (levels.length === 0) return 'none'

  let maxRank = 0
  let maxLevel: UncertaintyLevel = 'none'

  for (const level of levels) {
    const rank = UNCERTAINTY_RANK[level]
    if (rank !== undefined && rank > maxRank) {
      maxRank = rank
      maxLevel = level
    }
  }

  return maxLevel
}

/**
 * Downgrades confidence based on active uncertainty factors.
 * Each uncertainty factor has a confidence penalty.
 */
export function applyUncertaintyPenalty(
  base: ConfidenceLevel,
  uncertaintyLevel: UncertaintyLevel
): ConfidenceLevel {
  if (uncertaintyLevel === 'blocking') return 'blocked'
  if (uncertaintyLevel === 'high' && base === 'high') return 'medium'
  if (uncertaintyLevel === 'high' && base === 'medium') return 'low'
  if (uncertaintyLevel === 'medium' && base === 'high') return 'medium'
  return base
}

/**
 * Determines if confidence is sufficient to create an opportunity suggestion.
 * Architecture ref: execution-engine.md §3.7, §4.3.
 */
export function isSufficientForSuggestion(
  confidence: ConfidenceLevel,
  opportunityType: string
): boolean {
  // These opportunity types require at least 'medium' confidence
  const highRiskTypes = ['progression', 'detraction', 'excess_execution', 'hc']

  if (highRiskTypes.includes(opportunityType)) {
    return confidence === 'high' || confidence === 'medium'
  }

  // All other types: low confidence is acceptable (marked as low)
  return confidence !== 'unknown' && confidence !== 'blocked'
}

/**
 * Maps confidence to the uncertainty level for output reporting.
 */
export function confidenceToUncertaintyLevel(confidence: ConfidenceLevel): UncertaintyLevel {
  switch (confidence) {
    case 'high': return 'none'
    case 'medium': return 'low'
    case 'low': return 'medium'
    case 'unknown': return 'high'
    case 'blocked': return 'blocking'
  }
}
