/**
 * Runtime validation for document_extraction_results rows.
 *
 * Guards read boundaries against corrupted JSONB or invalid confidence values.
 */

const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const

export type ValidConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

export function assertExtractionStructuredData(
  value: unknown,
  context: string
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `[execflow/db] document_extraction_results.structured_data must be a plain object at ${context}, received ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`
    )
  }
}

export function assertExtractionConfidenceLevel(
  value: unknown,
  context: string
): asserts value is ValidConfidenceLevel {
  if (typeof value !== 'string' || !(CONFIDENCE_LEVELS as readonly string[]).includes(value)) {
    throw new Error(
      `[execflow/db] document_extraction_results.confidence must be one of ${CONFIDENCE_LEVELS.join(', ')} at ${context}, received ${String(value)}`
    )
  }
}

export function assertDocumentExtractionResultRow(
  row: { structuredData: unknown; confidence: unknown },
  context: string
): void {
  assertExtractionStructuredData(row.structuredData, context)
  assertExtractionConfidenceLevel(row.confidence, context)
}
