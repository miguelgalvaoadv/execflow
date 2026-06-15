/**
 * ExtractionEnvelope — the common wrapper for all extracted document data.
 *
 * Every extraction result is wrapped in this envelope which carries:
 * - The classification result (document type + confidence).
 * - The document-level confidence score (Exigência 4).
 * - The technical versioning metadata (Exigência 5).
 * - The type-specific structured data.
 * - Any detected conflicts between documents (Exigência 3).
 *
 * This is the structure stored in document_extraction_results.structuredData
 * and document_extraction_results.providerMetadata.
 *
 * MULTI-DOCUMENT READINESS (Exigência 2):
 * The envelope is always scoped to a single document (documentId).
 * Case-level consolidation from multiple envelopes is performed by the
 * Review Workspace and the promotion service — not by the LLM.
 */

import { z } from 'zod'
import { ExtractionVersioningSchema, ConflictReportSchema } from './field.ts'
import { ClassificationResultSchema } from './classification.ts'
import { SentenceSchema } from './sentence.ts'
import { ExecutionGuideSchema } from './execution-guide.ts'
import { JudgmentSchema } from './judgment.ts'
import { BehaviorReportSchema } from './behavior-report.ts'
import { CalculationSchema } from './calculation.ts'
import { DisciplinaryIncidentSchema } from './disciplinary.ts'
import { CourtDecisionSchema } from './court-decision.ts'

// ---------------------------------------------------------------------------
// Discriminated union of all document-specific schemas
// ---------------------------------------------------------------------------

export const DocumentDataSchema = z.discriminatedUnion('documentType', [
  z.object({ documentType: z.literal('sentenca'), data: SentenceSchema }),
  z.object({ documentType: z.literal('guia_execucao'), data: ExecutionGuideSchema }),
  z.object({ documentType: z.literal('acordao'), data: JudgmentSchema }),
  z.object({ documentType: z.literal('calculo'), data: CalculationSchema }),
  z.object({ documentType: z.literal('atestado_conduta'), data: BehaviorReportSchema }),
  z.object({ documentType: z.literal('pad'), data: DisciplinaryIncidentSchema }),
  z.object({ documentType: z.literal('decisao_judicial'), data: CourtDecisionSchema }),
  z.object({ documentType: z.literal('boletim_informativo'), data: z.record(z.string(), z.unknown()) }),
  z.object({ documentType: z.literal('desconhecido'), data: z.null() }),
])

export type DocumentData = z.infer<typeof DocumentDataSchema>

// ---------------------------------------------------------------------------
// Confidence label computation
// ---------------------------------------------------------------------------

/**
 * Maps a numeric confidence (0.0–1.0) to a human label.
 * Used for document_confidence_label and field badge rendering.
 */
export function confidenceLabel(
  score: number
): 'high' | 'medium' | 'low' | 'unknown' {
  if (score >= 0.85) return 'high'
  if (score >= 0.60) return 'medium'
  if (score > 0) return 'low'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// ExtractionEnvelope
// ---------------------------------------------------------------------------

export const ExtractionEnvelopeSchema = z.object({
  /** Document UUID this extraction was performed for. */
  documentId: z.string().uuid(),

  // ── Classification ────────────────────────────────────────────────────────

  /** Result of the classification step (step 1). */
  classification: ClassificationResultSchema,

  // ── Document-level confidence (Exigência 4) ───────────────────────────────

  /**
   * Aggregate confidence score for the entire extraction (0.0 to 1.0).
   * Computed as the weighted average of confidence scores for required fields.
   * If classification itself is uncertain, this also penalizes the score.
   */
  documentConfidence: z.number().min(0).max(1),

  /** Human-readable label derived from documentConfidence. */
  documentConfidenceLabel: z.enum(['high', 'medium', 'low', 'unknown']),

  // ── Structured data ───────────────────────────────────────────────────────

  /**
   * The document-type-specific extracted data.
   * null if documentType === 'desconhecido'.
   */
  documentData: DocumentDataSchema.nullable(),

  // ── Conflict detection (Exigência 3) ──────────────────────────────────────

  /**
   * Conflicts detected between this document and previously processed documents
   * for the same case. Populated by the ConflictDetectionService when
   * case-level facts are consolidated.
   * Empty array for single-document flows.
   */
  conflicts: z.array(ConflictReportSchema),

  /**
   * Whether any unresolved conflict blocks snapshot creation.
   * True if conflicts array contains any entry with resolution === 'unresolved'.
   */
  hasBlockingConflicts: z.boolean(),

  // ── Technical versioning (Exigência 5) ────────────────────────────────────

  /** Full technical provenance of this extraction. */
  versioning: ExtractionVersioningSchema,

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Whether this envelope passed the Validation Layer.
   * Populated by validation.ts AFTER the LLM extraction.
   * false → snapshot creation blocked; validationErrors contains details.
   */
  validationPassed: z.boolean(),

  /**
   * Validation errors from the Validation Layer.
   * Empty if validationPassed is true.
   */
  validationErrors: z.array(
    z.object({
      field: z.string(),
      message: z.string(),
      severity: z.enum(['error', 'warning']),
    })
  ),
})

export type ExtractionEnvelope = z.infer<typeof ExtractionEnvelopeSchema>
