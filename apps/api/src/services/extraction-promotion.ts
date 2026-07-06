/**
 * Extraction Promotion Service — promotes a confirmed extraction to a proposed snapshot.
 *
 * This is the BRIDGE between the LLM extraction pipeline and the sentence
 * snapshot lifecycle. It is the ONLY path from an extraction result to a
 * sentence_snapshot row.
 *
 * GOVERNANCE CONTRACT:
 * - The snapshot created here ALWAYS has status = 'proposed'.
 * - NO engine runs are triggered.
 * - NO opportunities are generated.
 * - NO deadlines are generated.
 * - NO pieces are created.
 * - Lawyer must separately confirm the snapshot (via the Cálculos workflow).
 *
 * FLOW:
 *   POST /api/v1/extractions/:id/promote-snapshot
 *   ↓
 *   promoteExtractionToSnapshot(ctx, extractionRunId, reviewedData)
 *   ↓
 *   1. Load extraction_run + document_extraction_result
 *   2. Validate reviewed data (Validation Layer)
 *   3. Map ExtractionEnvelope → ProposeSentenceSnapshotInput
 *   4. Insert sentence_snapshot (status = 'proposed')
 *   5. Insert snapshot_promotion (links extraction_run → snapshot)
 *   6. Emit domain event 'extraction.snapshot.promoted'
 *   7. Upsert queue_projection (snapshot_review queue)
 *
 * The lawyer then reviews the proposed snapshot in the "Cálculos" workspace
 * and confirms it separately.
 */

import { eq, and } from 'drizzle-orm'
import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import {
  ok,
  validationError,
  notFoundError,
  conflictError,
  internalServiceError,
  fromRepositoryError,
} from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import { hasMinRole, resolveMembershipRole } from '../lib/permissions.ts'
import { TxRepositoryError } from '../lib/tx.ts'
import { proposeSentenceSnapshot } from './sentence-snapshot.ts'
import { findExtractionRunById } from '../repositories/extraction-run.ts'
import { validateExtractionResult } from '@execflow/extraction'
import type { ExtractionEnvelope } from '@execflow/extraction'
import { assertDocumentExtractionResultRow } from '@execflow/db/types'
import {
  documentExtractionResults,
  documents,
  snapshotPromotions,
  queueProjections,
} from '@execflow/db/schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewedFieldOverride = {
  /** JSON path to the field being overridden. ex: "pena_total_anos" */
  fieldPath: string
  /** The corrected value provided by the lawyer. */
  correctedValue: unknown
}

export type PromoteExtractionInput = {
  /** The execution case this extraction should map to (required). */
  executionCaseId: string

  /**
   * The effective date for the proposed snapshot.
   * Typically: data_base from the extraction, or the document date.
   * Must be a valid ISO 8601 date.
   */
  effectiveAt: string

  /**
   * Optional overrides from the lawyer's review of specific fields.
   * Each override replaces the LLM-extracted value with the lawyer's correction.
   */
  fieldOverrides?: ReviewedFieldOverride[]

  /**
   * Optional justification for the promotion.
   * Stored in the domain event payload for audit.
   */
  reason?: string
}

export type PromoteExtractionResult = {
  snapshotId: string
  snapshotPromotionId: string
  executionCaseId: string
  documentId: string
  validationWarnings: Array<{ field: string; message: string }>
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export async function promoteExtractionToSnapshot(
  ctx: WriteContext,
  extractionRunId: string,
  input: PromoteExtractionInput
): Promise<ServiceResult<PromoteExtractionResult>> {
  // 1. RBAC: minimum 'assistant' role to promote, but snapshot confirmation requires 'lawyer'
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !hasMinRole(role, 'assistant')) {
    return validationError('Insufficient permissions to promote extraction to snapshot.')
  }

  // 2. Load extraction run
  const runResult = await findExtractionRunById(ctx.db, ctx.organizationId, extractionRunId)
  if (!runResult.success) {
    return notFoundError('Extraction run not found.')
  }
  const run = runResult.data

  if (run.status !== 'review' && run.status !== 'confirmed') {
    return conflictError(
      `Extraction run must be in 'review' or 'confirmed' status to promote (current: ${run.status}).`
    )
  }

  // 3. Load extraction result

  const [result] = await ctx.db
    .select()
    .from(documentExtractionResults)
    .where(eq(documentExtractionResults.extractionRunId, run.id))
    .limit(1)

  if (result === undefined) {
    return notFoundError('Extraction result not found for this run.')
  }

  assertDocumentExtractionResultRow(result, `promoteExtractionToSnapshot(${extractionRunId})`)

  const [doc] = await ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, run.documentId), eq(documents.organizationId, ctx.organizationId)))
    .limit(1)

  if (doc === undefined) {
    return notFoundError('Document not found.')
  }

  // 4. Check for existing promotion (idempotency)
  const [existingPromotion] = await ctx.db
    .select()
    .from(snapshotPromotions)
    .where(eq(snapshotPromotions.extractionRunId, run.id))
    .limit(1)

  if (existingPromotion !== undefined && existingPromotion.status === 'confirmed') {
    return conflictError(
      `Extraction run already promoted to snapshot (snapshotId: ${existingPromotion.snapshotId}).`
    )
  }

  // 5. Parse the ExtractionEnvelope from structuredData
  const envelope = result.structuredData as unknown as ExtractionEnvelope

  // 6. Apply field overrides from the lawyer's review
  if (input.fieldOverrides && input.fieldOverrides.length > 0) {
    for (const override of input.fieldOverrides) {
      applyFieldOverride(
        envelope as unknown as Record<string, unknown>,
        override.fieldPath,
        override.correctedValue
      )
    }
  }

  // 7. Validation Layer — re-validate after overrides
  const validation = validateExtractionResult(envelope)

  // Hard block on errors
  if (!validation.passed) {
    const errors = validation.issues.filter((i: any) => i.severity === 'error')
    return validationError(
      `Validation failed: ${errors.map((e: any) => `[${e.field}] ${e.message}`).join('; ')}`
    )
  }

  const warnings = validation.issues.filter((i: any) => i.severity === 'warning')

  // 8. Map extraction fields to ProposeSentenceSnapshotInput
  const snapshotInput = mapEnvelopeToSnapshotInput(envelope, input, doc.id)

  // 9. Propose snapshot (uses existing sentence-snapshot service)
  const snapshotResult = await proposeSentenceSnapshot(ctx, input.executionCaseId, snapshotInput)
  if (!snapshotResult.success) {
    return snapshotResult
  }
  const snapshot = snapshotResult.data

  // 10. Transactional: record the promotion link + domain event
  try {
    const promotionId = crypto.randomUUID()

    await withTx(ctx.db, async (tx) => {
      // Insert snapshot_promotion
      await tx.insert(snapshotPromotions).values({
        id: promotionId,
        organizationId: ctx.organizationId,
        sourceDocumentId: doc.id,
        extractionRunId: run.id,
        executionCaseId: input.executionCaseId,
        snapshotKind: 'sentence',
        snapshotId: snapshot.id,
        status: 'proposed',
        extractionType: run.extractionType,
        promotedByUserId: ctx.userId,
        promotedAt: new Date(),
        correlationId: ctx.correlationId ? ctx.correlationId : crypto.randomUUID(),
      })

      // Audit + domain event
      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'SentenceSnapshot',
        entityId: snapshot.id,
        changes: {
          type: 'creation',
          snapshot: {
            status: 'proposed',
            promotedFromExtractionRunId: run.id,
            documentId: doc.id,
          },
        },
        eventType: 'extraction.snapshot.promoted',
        aggregateType: 'SentenceSnapshot',
        aggregateId: snapshot.id,
        occurredAt: new Date(),
        eventPayload: {
          snapshotId: snapshot.id,
          executionCaseId: input.executionCaseId,
          organizationId: ctx.organizationId,
          extractionRunId: run.id,
          documentId: doc.id,
          promotionId,
          promotedByUserId: ctx.userId,
          reason: input.reason ?? 'Promoted from extraction review.',
          validationWarningCount: warnings.length,
        },
      })
    })

    // 11. Upsert snapshot_review queue projection
    const now = new Date()
    await ctx.db
      .insert(queueProjections)
      .values({
        organizationId: ctx.organizationId,
        queueType: 'snapshot_review',
        entityType: 'SentenceSnapshot',
        entityId: snapshot.id,
        executionCaseId: input.executionCaseId,
        status: 'active',
        priority: 2,
        displayTitle: `Cálculo proposto: ${doc.documentClass ?? 'documento'} — aguardando confirmação do advogado`,
        displayLabel: doc.documentClass ?? 'calculo_proposto',
        slaDeadlineAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        metadata: {
          snapshotId: snapshot.id,
          extractionRunId: run.id,
          documentId: doc.id,
          documentClass: doc.documentClass,
          documentConfidence: envelope.documentConfidence,
          validationWarningCount: warnings.length,
        },
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          queueProjections.organizationId,
          queueProjections.queueType,
          queueProjections.entityType,
          queueProjections.entityId,
        ],
        set: {
          status: 'active',
          priority: 2,
          displayTitle: `Cálculo proposto: ${doc.documentClass ?? 'documento'} — aguardando confirmação do advogado`,
          updatedAt: now,
        },
      })

    return ok({
      snapshotId: snapshot.id,
      snapshotPromotionId: promotionId,
      executionCaseId: input.executionCaseId,
      documentId: doc.id,
      validationWarnings: warnings.map((w: any) => ({ field: w.field, message: w.message })),
    })
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[extraction-promotion.service] promoteExtractionToSnapshot failed:', err)
    return internalServiceError('Failed to promote extraction to snapshot.', err)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Applies a field override to the envelope using dot-notation path.
 * ex: "documentData.data.pena_total_anos.value" = correctedValue
 */
function applyFieldOverride(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.')
  let current: Record<string, unknown> = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (typeof current[part] !== 'object' || current[part] === null) return
    current = current[part] as Record<string, unknown>
  }

  const lastPart = parts[parts.length - 1]!
  if (lastPart) {
    current[lastPart] = value
  }
}

/**
 * Maps an ExtractionEnvelope to ProposeSentenceSnapshotInput.
 *
 * Currently maps guia_execucao and sentenca. Other document types will be
 * added in Phase 5A.2 as the extraction schemas mature.
 */
function mapEnvelopeToSnapshotInput(
  envelope: ExtractionEnvelope,
  input: PromoteExtractionInput,
  documentId: string
) {
  const docType = envelope.classification.documentType
  const data = envelope.documentData?.documentType !== 'desconhecido'
    ? (envelope.documentData?.data as Record<string, { value: unknown }> | undefined)
    : undefined

  function getVal<T>(key: string, fallback: T): T {
    if (!data) return fallback
    const field = data[key]
    if (!field || typeof field !== 'object') return fallback
    return (field as { value: T }).value ?? fallback
  }

  // Compute total days from years/months/days
  const anos = getVal<number>('pena_total_anos', 0) ?? 0
  const meses = getVal<number>('pena_total_meses', 0) ?? 0
  const dias = getVal<number>('pena_total_dias', 0) ?? 0
  const totalSentenceDays = anos * 365 + meses * 30 + dias

  const detracao = docType === 'guia_execucao'
    ? (getVal<number>('detracao_aplicada_dias', 0) ?? 0)
    : (getVal<number>('detracao_dias', 0) ?? 0)

  const remicao = docType === 'guia_execucao'
    ? (getVal<number>('remicao_acumulada_dias', 0) ?? 0)
    : 0

  const tempoAno = getVal<number | null>('tempo_cumprido_anos', null)
  const tempoMes = getVal<number | null>('tempo_cumprido_meses', null)
  const tempoDia = getVal<number | null>('tempo_cumprido_dias', null)
  const servedDays =
    tempoAno !== null || tempoMes !== null || tempoDia !== null
      ? ((tempoAno ?? 0) * 365 + (tempoMes ?? 0) * 30 + (tempoDia ?? 0))
      : 0

  const confidence = envelope.documentConfidenceLabel as 'high' | 'medium' | 'low' | 'unknown'

  return {
    effectiveAt: input.effectiveAt,
    totalSentenceDays: Math.max(1, totalSentenceDays),
    servedDays,
    remissionDays: remicao,
    detractionDays: detracao,
    confidenceLevel: confidence,
    calculationMethod: `Promovido de extração LLM (${envelope.versioning.modelName} ${envelope.versioning.promptVersion})`,
    sourceDocumentIds: [documentId],
    explanation: {
      basis: `Extração automática via ${envelope.versioning.modelProvider} ${envelope.versioning.modelName}`,
      components: [],
      assumptions: [`Dados extraídos de ${envelope.classification.documentType} com confiança ${(envelope.documentConfidence * 100).toFixed(0)}%`],
      missingData: envelope.validationErrors.filter((e: any) => e.severity === 'warning').map((e: any) => e.message),
      legalCitations: [],
    },
    missingDataFlags: envelope.validationErrors
      .filter((e: any) => e.severity === 'warning')
      .map((e: any) => ({
        field: e.field,
        impact: 'medium' as const,
        description: e.message,
      })),
  }
}
