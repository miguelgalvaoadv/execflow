import type { OcrDocumentInput, OcrExtractResult, OcrProvider } from './types.ts'
import { OcrProviderError } from './types.ts'

export type MockOcrProviderOptions = {
  /** If set, always fail with this message (for failure/retry tests). */
  failWithMessage?: string | undefined
  /** Document IDs that should fail (retryable). */
  failDocumentIds?: Set<string> | undefined
}

/**
 * Mock OCR provider — deterministic text output for integration tests.
 * Does not read blob storage; simulates provider response from document metadata.
 */
export function createMockOcrProvider(
  env: Record<string, string | undefined> = process.env,
  options: MockOcrProviderOptions = {}
): OcrProvider {
  const failMessage = options.failWithMessage ?? env['OCR_MOCK_FAIL_MESSAGE']
  const failIds = options.failDocumentIds

  return {
    id: 'mock',

    async extractText(document: OcrDocumentInput): Promise<OcrExtractResult> {
      if (failMessage !== undefined && failMessage !== '') {
        throw new OcrProviderError(failMessage, { retryable: true })
      }
      if (failIds?.has(document.documentId) === true) {
        throw new OcrProviderError('Mock OCR simulated failure.', { retryable: true })
      }

      const pageCount =
        document.mimeType === 'application/pdf'
          ? Math.max(1, Math.min(10, Math.ceil(document.byteSize / 50_000)))
          : 1

      return {
        rawText: `[mock-ocr] file=${document.fileName} id=${document.documentId} pages=${pageCount}`,
        pageCount,
        providerMetadata: {
          provider: 'mock',
          mimeType: document.mimeType,
          byteSize: document.byteSize,
          simulated: true,
        },
      }
    },
  }
}

export type { OcrDocumentInput, OcrExtractResult, OcrProvider, OcrProviderError } from './types.ts'
