/**
 * ExecutionCase service — domain operations for the ExecutionCase entity.
 *
 * An ExecutionCase is the operational container for one *execução penal* matter.
 * Creating a case is a high-consequence action:
 * - It binds a client to an execution process.
 * - It sets the opened_at legal date (distinct from created_at system time).
 * - It may immediately set process_number_pending_since for SLA tracking.
 * - It ALWAYS creates an 'internal' TimelineEvent recording the case creation.
 *
 * TWO-CLOCK DISTINCTION:
 * - openedAt (input): legal/operational open date — may be in the past.
 * - createdAt (system): the current server timestamp.
 * These MUST be stored separately.
 * Architecture ref: execution-engine.md §0 (two clocks principle).
 *
 * PROCESS NUMBER:
 * At intake, the process number is often not yet known.
 * When provided, it is validated for plausible format.
 * Uniqueness within the org is enforced by the DB partial unique index.
 * Architecture ref: execution-workflows.md §0 (process number principle).
 */

import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { validateProcessNumber, normalizeProcessNumber } from '../lib/validation.ts'
import { insertCase, findCaseByProcessNumber } from '../repositories/execution-case.ts'
import { findClientById } from '../repositories/client.ts'
import { appendTimelineEvent } from '../repositories/timeline-event.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import { ok, validationError, conflictError, notFoundError, internalServiceError } from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import type { ExecutionCase } from '@execflow/db/schema'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateCaseInput = {
  /** The client this case belongs to. UUID. Required. */
  clientId: string

  /**
   * Firm-internal reference number. Required. Must be unique within the org.
   * Example: "EXE-2024-0042"
   */
  internalRef: string

  /**
   * Legal/operational open date (ISO 8601 datetime or date string).
   * TWO-CLOCK: this is the legal date — may predate system creation timestamp.
   * Required. Cannot be in the future.
   */
  openedAt: string

  /**
   * Processo de execução penal — the court's identifier.
   * Optional at intake (may not be known yet).
   * When provided: validated for plausible format.
   * When absent: process_number_pending_since is set for SLA tracking.
   */
  executionProcessNumber?: string | undefined

  /**
   * The originating conviction process number (processo de condenação).
   * Different from execution_process_number.
   */
  originProcessNumber?: string | undefined

  /** Court name. Example: "1ª VEP de São Paulo" */
  courtName?: string | undefined

  /** Comarca and state. Example: "São Paulo/SP" */
  courtJurisdiction?: string | undefined

  /** Type of case. Default: 'primary'. */
  caseKind?: 'primary' | 'apenso' | 'incident' | 'parallel' | undefined

  /** For apenso/incident: the parent case UUID. */
  parentExecutionCaseId?: string | undefined

  /**
   * The responsible lawyer UUID.
   * Defaults to the requesting user.
   */
  responsibleLawyerUserId?: string | undefined

  /**
   * Brief non-authoritative sentence summary.
   * Example: "5 anos, regime fechado"
   */
  sentenceSummary?: string | undefined
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

/**
 * Create a new execution case.
 *
 * Validation:
 * - clientId must refer to an existing, active client in the org
 * - internalRef must be provided
 * - openedAt must be a valid date (not in the future by more than 1 day)
 * - If executionProcessNumber provided: format validation + duplicate check
 *
 * Writes atomically: ExecutionCase + opening TimelineEvent + AuditLog + DomainEvent.
 */
export async function createCase(
  ctx: WriteContext,
  input: CreateCaseInput
): Promise<ServiceResult<ExecutionCase>> {
  // -------------------------------------------------------------------------
  // 1. Domain validation
  // -------------------------------------------------------------------------

  if (!input.clientId.trim()) {
    return validationError('Client ID is required.', 'clientId')
  }

  if (!input.internalRef.trim()) {
    return validationError('Internal reference number is required.', 'internalRef')
  }

  if (!input.openedAt) {
    return validationError('Legal open date (openedAt) is required.', 'openedAt')
  }

  const openedAtDate = new Date(input.openedAt)
  if (isNaN(openedAtDate.getTime())) {
    return validationError('openedAt must be a valid ISO 8601 date.', 'openedAt')
  }

  // Reject future dates beyond 1 day (clock skew tolerance)
  const oneDayFromNow = new Date(Date.now() + 86_400_000)
  if (openedAtDate > oneDayFromNow) {
    return validationError(
      'openedAt cannot be in the future. Use the actual legal open date.',
      'openedAt'
    )
  }

  let normalizedProcessNumber: string | undefined
  if (input.executionProcessNumber) {
    if (!validateProcessNumber(input.executionProcessNumber)) {
      return validationError(
        'Execution process number format is not recognized. Expected CNJ format (NNNNNNN-DD.AAAA.J.TT.OOOO) or a valid legacy format.',
        'executionProcessNumber'
      )
    }
    normalizedProcessNumber = normalizeProcessNumber(input.executionProcessNumber)
  }

  const lawyerUserId = input.responsibleLawyerUserId ?? ctx.userId

  // -------------------------------------------------------------------------
  // 2. Pre-condition checks (pre-transaction reads)
  // -------------------------------------------------------------------------

  // Verify client exists in this org
  const clientResult = await findClientById(ctx.db, ctx.organizationId, input.clientId)
  if (!clientResult.success) {
    return notFoundError('Client not found in this organization.')
  }
  if (clientResult.data.status !== 'active') {
    return validationError(
      `Client status is '${clientResult.data.status}'. Only active clients may have new cases opened.`,
      'clientId'
    )
  }

  // Process number duplicate check
  if (normalizedProcessNumber) {
    const existingCaseResult = await findCaseByProcessNumber(
      ctx.db,
      ctx.organizationId,
      normalizedProcessNumber
    )
    if (!existingCaseResult.success) {
      return internalServiceError('Failed to check process number uniqueness.')
    }
    if (existingCaseResult.data !== null) {
      return conflictError(
        `Process number ${normalizedProcessNumber} is already assigned to case ${existingCaseResult.data.internalRef} in this organization.`
      )
    }
  }

  // -------------------------------------------------------------------------
  // 3. Transactional write
  // -------------------------------------------------------------------------

  try {
    const executionCase = await withTx(ctx.db, async (tx) => {
      const now = new Date()
      const pendingSince = normalizedProcessNumber ? null : now

      const caseResult = unwrapOrThrow(
        await insertCase(tx, {
          organizationId: ctx.organizationId,
          clientId: input.clientId,
          internalRef: input.internalRef.trim(),
          executionProcessNumber: normalizedProcessNumber,
          originProcessNumber: input.originProcessNumber?.trim(),
          courtName: input.courtName?.trim(),
          courtJurisdiction: input.courtJurisdiction?.trim(),
          caseKind: input.caseKind ?? 'primary',
          parentExecutionCaseId: input.parentExecutionCaseId,
          status: 'intake',
          responsibleLawyerUserId: lawyerUserId,
          sentenceSummary: input.sentenceSummary?.trim(),
          openedAt: openedAtDate,
          processNumberPendingSince: pendingSince,
          createdAt: now,
          createdByUserId: ctx.userId,
          updatedAt: now,
        })
      )

      // Append the opening timeline event (immutable case creation marker)
      await appendTimelineEvent(tx, {
        organizationId: ctx.organizationId,
        executionCaseId: caseResult.id,
        eventType: 'case.opened',
        eventCategory: 'internal',
        occurredAt: openedAtDate,     // LEGAL TIME: when case was legally opened
        // recordedAt: set by DB default (system time of ingestion)
        summary: `Case opened. Internal reference: ${caseResult.internalRef}.`,
        payload: {
          internalRef: caseResult.internalRef,
          processNumber: normalizedProcessNumber ?? null,
          status: 'intake',
          lawyerUserId,
        },
        source: 'system_rule',
        actorType: 'user',
        actorId: ctx.actor.actorId,
        authorUserId: ctx.userId,
        visibility: 'internal',
      })

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'ExecutionCase',
        entityId: caseResult.id,
        changes: {
          type: 'creation',
          snapshot: {
            status: 'intake',
            clientId: input.clientId,
            internalRef: caseResult.internalRef,
            processNumber: normalizedProcessNumber ?? null,
          },
        },
        eventType: 'case.created',
        aggregateType: 'ExecutionCase',
        aggregateId: caseResult.id,
        occurredAt: openedAtDate,
        eventPayload: {
          caseId: caseResult.id,
          clientId: input.clientId,
          organizationId: ctx.organizationId,
          status: 'intake',
          internalRef: caseResult.internalRef,
          processNumber: normalizedProcessNumber ?? null,
          openedAt: openedAtDate.toISOString(),
          createdByUserId: ctx.userId,
        },
      })

      return caseResult
    })

    return ok(executionCase)
  } catch (err) {
    if (err instanceof Error && err.message.includes('execution_cases_process_number_unique')) {
      return conflictError('Process number is already assigned to another case in this organization.')
    }
    if (err instanceof Error && err.message.includes('execution_cases_internal_ref_unique')) {
      return conflictError('Internal reference number is already in use in this organization.')
    }

    console.error('[case.service] createCase failed:', err)
    return internalServiceError('Failed to create execution case.', err)
  }
}
