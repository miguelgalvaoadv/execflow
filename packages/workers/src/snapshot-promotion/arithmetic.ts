/**
 * Sentence snapshot arithmetic — worker-side derivation (mirrors apps/api snapshot-arithmetic).
 */

export type SentenceArithmeticInput = {
  totalSentenceDays: number
  servedDays: number
  remissionDays: number
  detractionDays: number
}

export function computeRemainingDays(input: SentenceArithmeticInput): number {
  const raw =
    input.totalSentenceDays - input.servedDays - input.remissionDays - input.detractionDays
  return Math.max(0, raw)
}

export function computePercentServed(input: SentenceArithmeticInput): string {
  if (input.totalSentenceDays <= 0) return '0.0000'
  const credited = input.servedDays + input.remissionDays + input.detractionDays
  const fraction = Math.min(1, credited / input.totalSentenceDays)
  return fraction.toFixed(4)
}

export function validateSentenceArithmetic(input: SentenceArithmeticInput): string | null {
  if (input.totalSentenceDays < 1) {
    return 'totalSentenceDays must be at least 1.'
  }
  for (const [field, value] of [
    ['servedDays', input.servedDays],
    ['remissionDays', input.remissionDays],
    ['detractionDays', input.detractionDays],
  ] as const) {
    if (value < 0) {
      return `${field} cannot be negative.`
    }
  }
  const credited = input.servedDays + input.remissionDays + input.detractionDays
  if (credited > input.totalSentenceDays) {
    return 'servedDays + remissionDays + detractionDays cannot exceed totalSentenceDays.'
  }
  return null
}
