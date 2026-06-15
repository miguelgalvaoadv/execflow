/**
 * @execflow/extraction — Extraction provider factory.
 *
 * Supported providers:
 *   'mock'      → MockExtractionProvider (dev/test; no network calls)
 *   'anthropic' → AnthropicExtractionProvider (Claude Sonnet; Phase 5A.1+)
 *
 * Environment variables:
 *   EXTRACTION_PROVIDER   = 'mock' | 'anthropic'  (default: 'mock')
 *   ANTHROPIC_API_KEY     = <key>                  (required if 'anthropic')
 *   EXTRACTION_MAX_ATTEMPTS = <n>                  (default: 3)
 *   EXTRACTION_DEFAULT_TYPE = <type>               (default: 'generic')
 */

import { createMockExtractionProvider } from './mock-provider.ts'
import { createAnthropicExtractionProvider } from './anthropic-provider.ts'
import type { ExtractionProvider } from './types.ts'

export type ExtractionProviderId = 'mock' | 'anthropic'

export function resolveExtractionProviderId(
  env: Record<string, string | undefined> = process.env
): ExtractionProviderId {
  const id = env['EXTRACTION_PROVIDER'] ?? 'mock'
  if (id === 'mock') return 'mock'
  if (id === 'anthropic') return 'anthropic'
  throw new Error(
    `[extraction] Unsupported EXTRACTION_PROVIDER: "${id}". Supported: 'mock', 'anthropic'.`
  )
}

export function createExtractionProvider(
  env: Record<string, string | undefined> = process.env
): ExtractionProvider {
  const id = resolveExtractionProviderId(env)

  if (id === 'mock') {
    return createMockExtractionProvider(env)
  }

  if (id === 'anthropic') {
    const apiKey = env['ANTHROPIC_API_KEY']
    if (!apiKey || apiKey.trim() === '') {
      console.warn(
        '[extraction] ANTHROPIC_API_KEY is missing or empty. Falling back to MockExtractionProvider for safety.'
      )
      return createMockExtractionProvider(env)
    }
    return createAnthropicExtractionProvider({ apiKey })
  }

  throw new Error(`[extraction] No provider factory for: ${id}`)
}

export function resolveExtractionMaxAttempts(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env['EXTRACTION_MAX_ATTEMPTS']
  if (raw === undefined || raw === '') return 3
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 3
}

export function resolveDefaultExtractionType(
  env: Record<string, string | undefined> = process.env
): string {
  return env['EXTRACTION_DEFAULT_TYPE']?.trim() || 'generic'
}

// Re-exports
export { createMockExtractionProvider } from './mock-provider.ts'
export { createAnthropicExtractionProvider } from './anthropic-provider.ts'
export { ExtractionProviderError } from './types.ts'
export type { ExtractionInput, ExtractionOutput, ExtractionProvider } from './types.ts'

// Schema exports
export type { ExtractedField, FieldEvidence, ExtractionVersioning, ConflictReport } from './schemas/field.ts'
export type { DocumentClass, ClassificationResult } from './schemas/classification.ts'
export type { ExtractionEnvelope } from './schemas/envelope.ts'
export { validateExtractionResult } from './validation.ts'
export type { ValidationReport, ValidationIssue } from './validation.ts'
