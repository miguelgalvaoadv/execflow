/**
 * Global blocking condition evaluator.
 *
 * Checks whether any global blocking code is active for a case.
 * Global blocking codes suppress ALL liberty-affecting opportunity suggestions
 * unless a lawyer explicitly overrides with documented reason.
 *
 * Blocking codes (execution-engine.md §4.2):
 * BLK_ESCAPE              — Escape interruption active
 * BLK_SNAPSHOT_UNCONFIRMED— No confirmed SentenceSnapshot within 180 days
 * BLK_PROCESS_PENDING     — Execution process number not confirmed
 * BLK_LEGAL_HOLD          — Case under legal hold
 * BLK_UNIFICATION_PENDING — Multiple lines without unified snapshot
 * BLK_CRITICAL_VALIDATION — Open critical validation on arithmetic
 *
 * Architecture ref: execution-engine.md §4.2.
 */

import type { CaseFacts, GlobalBlockingCode } from '../types/index.ts'

export type BlockingEvaluationResult = {
  hasGlobalBlock: boolean
  activeCodes: GlobalBlockingCode[]
  /** Active codes that fully suppress all liberty suggestions (severity='full'). */
  fullBlockCodes: string[]
  /** Active codes that partially suppress suggestions (severity='partial'). */
  partialBlockCodes: string[]
}

/**
 * Evaluates all global blocking conditions from case facts.
 * Returns a structured result describing active blocks.
 */
export function evaluateGlobalBlocking(
  facts: CaseFacts,
  additionalBlockCodes: string[] = []
): BlockingEvaluationResult {
  const activeCodes: GlobalBlockingCode[] = []

  // BLK_ESCAPE
  const escapeInterruption = facts.activeInterruptions.find(
    (i) => i.type === 'all_liberty'
  )
  if (escapeInterruption !== undefined) {
    activeCodes.push({
      code: 'BLK_ESCAPE',
      reason: escapeInterruption.reason,
      severity: 'full',
    })
  }

  // BLK_SNAPSHOT_UNCONFIRMED
  if (!facts.hasRecentConfirmedSnapshot) {
    activeCodes.push({
      code: 'BLK_SNAPSHOT_UNCONFIRMED',
      reason: 'No confirmed SentenceSnapshot within required period',
      severity: 'full',
    })
  }

  // BLK_PROCESS_PENDING
  if (!facts.hasConfirmedProcessNumber) {
    activeCodes.push({
      code: 'BLK_PROCESS_PENDING',
      reason: 'Execution process number is pending confirmation',
      severity: 'partial',
    })
  }

  // Additional codes from configuration (e.g., playbook-driven)
  for (const code of additionalBlockCodes) {
    activeCodes.push({
      code,
      reason: `Active from configuration: ${code}`,
      severity: 'partial',
    })
  }

  const fullBlockCodes = activeCodes.filter((c) => c.severity === 'full').map((c) => c.code)
  const partialBlockCodes = activeCodes.filter((c) => c.severity === 'partial').map((c) => c.code)

  return {
    hasGlobalBlock: fullBlockCodes.length > 0,
    activeCodes,
    fullBlockCodes,
    partialBlockCodes,
  }
}

/**
 * Checks if a specific opportunity type is suppressed by active blocking codes.
 * Some opportunity types are only suppressed by full blocks, not partial ones.
 */
export function isOpportunityBlocked(
  opportunityType: string,
  blocking: BlockingEvaluationResult
): boolean {
  if (blocking.hasGlobalBlock) return true

  // For high-risk opportunity types, partial blocks also suppress
  const highRiskTypes = ['progression', 'livramento', 'excess_execution', 'hc']
  if (highRiskTypes.includes(opportunityType) && blocking.partialBlockCodes.length > 0) {
    // BLK_PROCESS_PENDING suppresses progression and high-risk types
    if (blocking.partialBlockCodes.includes('BLK_PROCESS_PENDING')) return true
  }

  return false
}
