/**
 * OCR provider factory.
 *
 * Providers:
 *   'pdf-text' (PADRÃO) — extração real do texto nativo do PDF via pdfjs-dist,
 *       página a página com marcador \f (alimenta a citação de página da
 *       busca nos autos). Exige deps.getObject (leitura do storage, injetada
 *       pelo worker). PDFs escaneados sem camada de texto falham com erro
 *       claro e não-retryable — nunca fingem sucesso.
 *   'mock' — determinístico para testes; não lê storage.
 */

import { createMockOcrProvider } from './mock-provider.ts'
import { createPdfTextOcrProvider, type PdfTextProviderDeps } from './pdf-text-provider.ts'
import type { OcrProvider } from './types.ts'

export type OcrProviderId = 'mock' | 'pdf-text'

export function resolveOcrProviderId(
  env: Record<string, string | undefined> = process.env
): OcrProviderId {
  const id = env['OCR_PROVIDER'] ?? 'pdf-text'
  if (id === 'mock') return 'mock'
  if (id === 'pdf-text') return 'pdf-text'
  throw new Error(
    `[ocr] Unsupported OCR_PROVIDER: ${id}. Available: 'pdf-text' (default), 'mock'.`
  )
}

export function createOcrProvider(
  env: Record<string, string | undefined> = process.env,
  deps?: PdfTextProviderDeps
): OcrProvider {
  const id = resolveOcrProviderId(env)
  if (id === 'mock') {
    return createMockOcrProvider(env)
  }
  if (id === 'pdf-text') {
    if (!deps?.getObject) {
      throw new Error(
        "[ocr] OCR_PROVIDER='pdf-text' exige a injeção de deps.getObject (leitura do storage). Passe createOcrProvider(env, { getObject }) ou use OCR_PROVIDER=mock."
      )
    }
    return createPdfTextOcrProvider(deps)
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
export { createPdfTextOcrProvider } from './pdf-text-provider.ts'
export type { PdfTextProviderDeps } from './pdf-text-provider.ts'
export { OcrProviderError } from './types.ts'
export type { OcrDocumentInput, OcrExtractResult, OcrProvider } from './types.ts'
