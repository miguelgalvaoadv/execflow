/**
 * Maps extraction structured_data to snapshot propose inputs.
 */

import type { SnapshotKind, ConfidenceLevel } from '@execflow/db/types'
import {
  computePercentServed,
  computeRemainingDays,
  validateSentenceArithmetic,
  type SentenceArithmeticInput,
} from './arithmetic.ts'

const CUSTODY_REGIMES = [
  'fechado',
  'semiaberto',
  'aberto',
  'albergue',
  'domiciliar',
  'provisorio',
  'unknown',
] as const

export type MappedSentenceProposal = {
  kind: 'sentence'
  effectiveAt: Date
  arithmetic: SentenceArithmeticInput
  remainingDays: number
  percentServed: string
  confidenceLevel: ConfidenceLevel
  sourceDocumentIds: string[]
  explanation: Record<string, unknown>
}

export type MappedCustodyProposal = {
  kind: 'custody'
  effectiveAt: Date
  regime: (typeof CUSTODY_REGIMES)[number]
  confidence: ConfidenceLevel
  notes: string | null
}

export type MappedSnapshotProposal = MappedSentenceProposal | MappedCustodyProposal

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readConfidence(value: unknown, fallback: ConfidenceLevel): ConfidenceLevel {
  if (value === 'high' || value === 'medium' || value === 'low' || value === 'unknown') {
    return value
  }
  return fallback
}

function readBlock(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const block = data[key]
  if (block !== null && typeof block === 'object' && !Array.isArray(block)) {
    return block as Record<string, unknown>
  }
  const fields = data['fields']
  if (fields !== null && typeof fields === 'object' && !Array.isArray(fields)) {
    const nested = (fields as Record<string, unknown>)[key]
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>
    }
  }
  return {}
}

export function mapStructuredDataToSnapshotProposal(params: {
  snapshotKind: SnapshotKind
  structuredData: Record<string, unknown>
  sourceDocumentId: string
  extractedAt: Date
  defaultConfidence: ConfidenceLevel
}): MappedSnapshotProposal | { error: string } {
  const { snapshotKind, structuredData, sourceDocumentId, extractedAt, defaultConfidence } = params

  if (snapshotKind === 'sentence') {
    const block = readBlock(structuredData, 'sentence')
    const arithmetic: SentenceArithmeticInput = {
      totalSentenceDays: readNumber(block['totalSentenceDays'], 3650),
      servedDays: readNumber(block['servedDays'], 0),
      remissionDays: readNumber(block['remissionDays'], 0),
      detractionDays: readNumber(block['detractionDays'], 0),
    }
    const err = validateSentenceArithmetic(arithmetic)
    if (err !== null) return { error: err }

    return {
      kind: 'sentence',
      effectiveAt: extractedAt,
      arithmetic,
      remainingDays: computeRemainingDays(arithmetic),
      percentServed: computePercentServed(arithmetic),
      confidenceLevel: readConfidence(block['confidence'], defaultConfidence),
      sourceDocumentIds: [sourceDocumentId],
      explanation: {
        promotionSource: 'extraction',
        mappedFrom: 'structured_data.sentence',
      },
    }
  }

  const block = readBlock(structuredData, 'custody')
  const regimeRaw = typeof block['regime'] === 'string' ? block['regime'] : 'unknown'
  const regime = (CUSTODY_REGIMES as readonly string[]).includes(regimeRaw)
    ? (regimeRaw as (typeof CUSTODY_REGIMES)[number])
    : 'unknown'

  return {
    kind: 'custody',
    effectiveAt: extractedAt,
    regime,
    confidence: readConfidence(block['confidence'], defaultConfidence),
    notes: typeof block['notes'] === 'string' ? block['notes'] : null,
  }
}
