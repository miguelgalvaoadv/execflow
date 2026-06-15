/**
 * Extraction provider types — structured data from OCR raw text.
 */

export type ExtractionInput = {
  documentId: string
  organizationId: string
  extractionType: string
  rawText: string
  ocrResultId: string
  ocrRunId: string
  documentClass: string | null
}

export type ExtractionOutput = {
  structuredData: Record<string, unknown>
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  providerMetadata: Record<string, unknown>
}

export class ExtractionProviderError extends Error {
  readonly retryable: boolean

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message)
    this.name = 'ExtractionProviderError'
    this.retryable = options?.retryable ?? true
  }
}

export interface ExtractionProvider {
  readonly id: string
  extractStructured(input: ExtractionInput): Promise<ExtractionOutput>
}
