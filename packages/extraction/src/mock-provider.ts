import type { ExtractionInput, ExtractionOutput, ExtractionProvider } from './types.ts'
import { ExtractionProviderError } from './types.ts'

export type MockExtractionProviderOptions = {
  failWithMessage?: string | undefined
  failDocumentIds?: Set<string> | undefined
}

/**
 * Mock extraction provider — deterministic structured output for integration tests.
 * Does not call LLM; derives simple fields from OCR raw text metadata.
 */
export function createMockExtractionProvider(
  env: Record<string, string | undefined> = process.env,
  options: MockExtractionProviderOptions = {}
): ExtractionProvider {
  const failMessage = options.failWithMessage ?? env['EXTRACTION_MOCK_FAIL_MESSAGE']
  const failIds = options.failDocumentIds

  return {
    id: 'mock',

    async extractStructured(input: ExtractionInput): Promise<ExtractionOutput> {
      if (failMessage !== undefined && failMessage !== '') {
        throw new ExtractionProviderError(failMessage, { retryable: true })
      }
      if (failIds?.has(input.documentId) === true) {
        throw new ExtractionProviderError('Mock extraction simulated failure.', {
          retryable: true,
        })
      }

      const lines = input.rawText.split('\n').filter((line) => line.trim().length > 0)

      return {
        structuredData: {
          documentId: input.documentId,
          extractionType: input.extractionType,
          documentClass: input.documentClass,
          sourceLength: input.rawText.length,
          lineCount: lines.length,
          preview: input.rawText.slice(0, 120),
          fields: {
            title: `[mock-extraction] ${input.documentClass ?? 'document'}`,
            firstLine: lines[0] ?? '',
          },
        },
        confidence: 'medium',
        providerMetadata: {
          provider: 'mock',
          ocrResultId: input.ocrResultId,
          simulated: true,
        },
      }
    },
  }
}
