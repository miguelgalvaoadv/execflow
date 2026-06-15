/**
 * OCR provider factory — mock provider for dev/test; Textract etc. plug in here later.
 */

import { createMockOcrProvider } from './mock-provider.ts'
import type { OcrProvider } from './types.ts'

export type OcrProviderId = 'mock'

export function resolveOcrProviderId(
  env: Record<string, string | undefined> = process.env
): OcrProviderId {
  const id = env['OCR_PROVIDER'] ?? 'mock'
  if (id === 'mock') return 'mock'
  throw new Error(`[ocr] Unsupported OCR_PROVIDER: ${id}. Only 'mock' is available in this phase.`)
}

export function createOcrProvider(
  env: Record<string, string | undefined> = process.env
): OcrProvider {
  const id = resolveOcrProviderId(env)
  if (id === 'mock') {
    return createMockOcrProvider(env)
  }
  throw new Error(`[ocr] No provider factory for: ${id}`)
}

export function resolveOcrMaxAttempts(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env['OCR_MAX_ATTEMPTS']
  if (raw === undefined || raw === '') return 3
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 3
}

export { createMockOcrProvider } from './mock-provider.ts'
export { OcrProviderError } from './types.ts'
export type { OcrDocumentInput, OcrExtractResult, OcrProvider } from './types.ts'
