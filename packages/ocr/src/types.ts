/**
 * OCR provider types.
 */

export type OcrDocumentInput = {
  documentId: string
  organizationId: string
  storageKey: string
  mimeType: string
  fileName: string
  byteSize: number
}

export type OcrExtractResult = {
  rawText: string
  pageCount: number
  providerMetadata: Record<string, unknown>
}

export class OcrProviderError extends Error {
  readonly retryable: boolean

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message)
    this.name = 'OcrProviderError'
    this.retryable = options?.retryable ?? true
  }
}

export interface OcrProvider {
  readonly id: string
  extractText(document: OcrDocumentInput): Promise<OcrExtractResult>
}
