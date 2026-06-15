/**
 * Intake service — domain operations for the IntakeBundle entity.
 *
 * Intake is the entry point for all new information into EXECFLOW.
 * Every channel (manual form, PDF upload, WhatsApp forward) produces an IntakeBundle.
 *
 * INCOMPLETE INTAKE SUPPORT:
 * Bundles can be created with missing information (missing_fields populated).
 * This is intentional — the system supports partial intake and recovery workflows.
 * A bundle in 'received' status is valid even with no associated files yet.
 *
 * OCR EXCLUSION:
 * This phase does NOT implement OCR extraction. Bundles are created in 'received'
 * status. OCR pipeline transitions (extraction_pending → extraction_review) are Phase 5+.
 *
 * Architecture ref: execution-workflows.md §1 (intake state machine),
 *                   data-model-v1.md §3.5 (IntakeBundle).
 */

import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { insertBundle } from '../repositories/intake-bundle.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import { ok, validationError, internalServiceError } from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import type { IntakeBundle } from '@execflow/db/schema'
import type { IntakeSourceChannel } from '@execflow/db/types'
import {
  INTAKE_REGISTERED,
  buildIntakeRegisteredPayload,
} from '@execflow/db/types'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type RegisterIntakeBundleInput = {
  /**
   * How this bundle entered the system.
   * Must match the intake_source_channel enum.
   */
  sourceChannel: IntakeSourceChannel

  /**
   * When this bundle was operationally received.
   * For manual uploads: typically NOW(). For WhatsApp: connector receipt time.
   * This is distinct from the DB creation timestamp (createdAt).
   */
  receivedAt?: string | undefined

  /**
   * Pre-populated proposed client association (from OCR or prior context).
   * NOT authoritative — requires human review.
   */
  proposedClientId?: string | undefined

  /**
   * Pre-populated proposed case association.
   * NOT authoritative — requires human review.
   */
  proposedExecutionCaseId?: string | undefined

  /**
   * Known missing data fields at intake creation time.
   * Format: [{ field: string, reason: string, required: boolean }]
   * Used for recovery workflow: "these fields must be completed before activation."
   */
  missingFields?: Array<{ field: string; reason: string; required: boolean }> | undefined

  /** Free-text operational notes about this intake. */
  notes?: string | undefined
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

/**
 * Register a new intake bundle.
 *
 * This is the first step of the intake workflow. The bundle starts in 'received' state.
 * Documents are registered separately (see document.service.ts) and linked to the bundle.
 *
 * NO OCR IS TRIGGERED HERE. That is Phase 5+.
 *
 * Writes atomically: IntakeBundle + AuditLog + DomainEvent.
 */
export async function registerIntakeBundle(
  ctx: WriteContext,
  input: RegisterIntakeBundleInput
): Promise<ServiceResult<IntakeBundle>> {
  // -------------------------------------------------------------------------
  // 1. Domain validation
  // -------------------------------------------------------------------------

  const validChannels: IntakeSourceChannel[] = [
    'intake_manual',
    'intake_pdf',
    'intake_scan',
    'intake_whatsapp',
    'intake_email',
    'intake_api',
    'intake_tribunal',
  ]

  if (!validChannels.includes(input.sourceChannel)) {
    return validationError(
      `Invalid source channel: '${input.sourceChannel}'.`,
      'sourceChannel'
    )
  }

  let receivedAt: Date
  if (input.receivedAt) {
    receivedAt = new Date(input.receivedAt)
    if (isNaN(receivedAt.getTime())) {
      return validationError('receivedAt must be a valid ISO 8601 datetime.', 'receivedAt')
    }
  } else {
    receivedAt = new Date()
  }

  // -------------------------------------------------------------------------
  // 2. Transactional write
  // -------------------------------------------------------------------------

  try {
    const bundle = await withTx(ctx.db, async (tx) => {
      const now = new Date()

      const bundleResult = unwrapOrThrow(
        await insertBundle(tx, {
          organizationId: ctx.organizationId,
          sourceChannel: input.sourceChannel,
          receivedAt,
          uploaderUserId: ctx.userId,
          status: 'received',
          proposedClientId: input.proposedClientId,
          proposedExecutionCaseId: input.proposedExecutionCaseId,
          missingFields: input.missingFields ?? null,
          notes: input.notes?.trim(),
          fileCount: 0,
          createdAt: now,
          updatedAt: now,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'IntakeBundle',
        entityId: bundleResult.id,
        changes: {
          type: 'creation',
          snapshot: {
            status: 'received',
            sourceChannel: input.sourceChannel,
            hasMissingFields: (input.missingFields?.length ?? 0) > 0,
          },
        },
        eventType: INTAKE_REGISTERED,
        aggregateType: 'IntakeBundle',
        aggregateId: bundleResult.id,
        occurredAt: receivedAt,
        eventPayload: buildIntakeRegisteredPayload({
          intakeBundleId: bundleResult.id,
          organizationId: ctx.organizationId,
          sourceChannel: input.sourceChannel,
          receivedAt,
          uploaderUserId: ctx.userId,
          ref: input.notes?.trim() || input.sourceChannel,
          hasMissingFields: (input.missingFields?.length ?? 0) > 0,
          missingFieldCount: input.missingFields?.filter((f) => f.required).length ?? 0,
        }),
      })

      return bundleResult
    })

    return ok(bundle)
  } catch (err) {
    console.error('[intake.service] registerIntakeBundle failed:', err)
    return internalServiceError('Failed to register intake bundle.', err)
  }
}
