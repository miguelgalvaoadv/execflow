/**
 * Base types for extracted fields with full evidence mapping.
 *
 * EVIDENCE MAPPING:
 * Every extracted field MUST carry its origin so lawyers can click any field
 * and see the exact source document, page, and text snippet that produced it.
 *
 * CONFLICT DETECTION:
 * When multiple documents produce incompatible values for the same field,
 * a ConflictReport is generated. Unresolved conflicts block snapshot creation.
 *
 * EXTRACTION VERSIONING:
 * Every extraction result MUST record the technical provenance: which model,
 * which prompt version, when. Required for future audits.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Evidence — origin of an extracted field
// ---------------------------------------------------------------------------

export const FieldEvidenceSchema = z.object({
  /** Document UUID that contains this evidence. */
  documentId: z.string().uuid(),

  /** Blob storage key for direct reference. */
  storageKey: z.string(),

  /** Page number within the document (1-indexed, null if not paginated). */
  pageNumber: z.number().int().positive().nullable(),

  /**
   * Short verbatim snippet from the source text that sustains this extraction.
   * Max 500 chars. Null if the model could not isolate the snippet.
   */
  textSnippet: z.string().max(500).nullable(),
})

export type FieldEvidence = z.infer<typeof FieldEvidenceSchema>

// ---------------------------------------------------------------------------
// ExtractedField — value + confidence + evidence
// ---------------------------------------------------------------------------

/**
 * Wrapper for every field extracted by the LLM.
 * Generic T is the actual value type (string, number, Date, etc.).
 *
 * Confidence scale:
 *  >= 0.85  → high   (show green badge, pre-fill in UI)
 *  >= 0.60  → medium (show yellow badge, prompt for review)
 *   < 0.60  → low    (show red badge, require manual entry)
 */
export function extractedFieldSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    confidence: z.number().min(0).max(1),
    evidence: FieldEvidenceSchema,
  })
}

export type ExtractedField<T> = {
  value: T
  confidence: number
  evidence: FieldEvidence
}

// ---------------------------------------------------------------------------
// Extraction Versioning — technical provenance of an extraction result
// ---------------------------------------------------------------------------

export const ExtractionVersioningSchema = z.object({
  /** Semver of the extraction package. Bump on any prompt or schema change. */
  extractionVersion: z.string(),

  /** LLM provider: 'anthropic' | 'openai' | 'mock' */
  modelProvider: z.string(),

  /** Model name as used in the API call. ex: 'claude-sonnet-4-5' */
  modelName: z.string(),

  /** Model version/snapshot. ex: '20241022' */
  modelVersion: z.string(),

  /** Prompt template identifier. ex: 'penal-extraction-v1' */
  promptVersion: z.string(),

  /** ISO timestamp of when the extraction was run. */
  extractedAt: z.string().datetime(),
})

export type ExtractionVersioning = z.infer<typeof ExtractionVersioningSchema>

// ---------------------------------------------------------------------------
// Conflict Detection — incompatible values across documents
// ---------------------------------------------------------------------------

export const ConflictingValueSchema = z.object({
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  documentId: z.string().uuid(),
  documentClass: z.string(),
})

export const ConflictReportSchema = z.object({
  /** JSON path to the conflicting field. ex: "pena_total.anos" */
  fieldPath: z.string(),

  /** All competing values found across documents. */
  conflictingValues: z.array(ConflictingValueSchema).min(2),

  /**
   * Resolution status.
   * 'unresolved' → blocks snapshot creation.
   * 'human_selected' → lawyer manually chose a value.
   * 'auto_highest_confidence' → system auto-selected (only for non-critical fields).
   */
  resolution: z.enum(['unresolved', 'human_selected', 'auto_highest_confidence']),

  /** The resolved value (if resolution !== 'unresolved'). */
  resolvedValue: z.unknown().optional(),
})

export type ConflictReport = z.infer<typeof ConflictReportSchema>
