/**
 * Client service — domain operations for the Client entity.
 *
 * Service rules:
 * 1. Receives WriteContext — never imports HTTP context.
 * 2. Opens its own transaction for all write operations.
 * 3. Writes AuditLog + DomainEvent in the same transaction as the entity.
 * 4. Returns ServiceResult<T> — never throws to callers.
 * 5. Validates domain rules (CPF uniqueness, required fields) before writing.
 *
 * LGPD NOTE:
 * cpf, rg, birthDate, contactChannels are sensitive fields.
 * This service stores them as received (validated and normalized).
 * Access logging for reads of sensitive fields is a future Phase 5+ concern
 * (requires a dedicated "read-sensitive" audit action type).
 */

import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { validateAndNormalizeCpf } from '../lib/validation.ts'
import { insertClient, findClientByCpf } from '../repositories/client.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import { ok, validationError, conflictError, internalServiceError } from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import type { Client } from '@execflow/db/schema'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateClientInput = {
  /** Legal name as on identity documents. Required. */
  fullName: string

  /**
   * CPF — formatted or unformatted. Normalized before storage.
   * LGPD sensitive. Required if internalRef is not provided.
   */
  cpf?: string | undefined

  /** RG — secondary identity document. LGPD sensitive. */
  rg?: string | undefined

  /** Matrícula do réu no sistema penitenciário (ex.: matrícula SAP). */
  matricula?: string | undefined

  /** Date of birth (ISO 8601 date string: "YYYY-MM-DD"). LGPD sensitive. */
  birthDate?: string | undefined

  /** Social/preferred name. NOT used in legal filings. */
  displayName?: string | undefined

  /** Array of aliases, apelidos, or alternative names. */
  aliases?: string[] | undefined

  /**
   * Firm-internal reference number.
   * Required if cpf is not provided.
   */
  internalRef?: string | undefined

  /**
   * UUID of the responsible lawyer user.
   * Defaults to the requesting user if not specified.
   */
  responsibleLawyerUserId?: string | undefined

  /** Contact channels. LGPD sensitive. */
  contactChannels?: Array<{ type: string; value: string; notes?: string | undefined }> | undefined

  /** Free-text operational notes. */
  notes?: string | undefined
}

export type UpdateClientInput = Partial<CreateClientInput>

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

/**
 * Create a new client record.
 *
 * Validation:
 * - fullName is required
 * - cpf OR internalRef must be provided
 * - If cpf provided: validate format + checksum, check for duplicates
 *
 * Writes atomically: Client + AuditLog + DomainEvent.
 */
export async function createClient(
  ctx: WriteContext,
  input: CreateClientInput
): Promise<ServiceResult<Client>> {
  // -------------------------------------------------------------------------
  // 1. Domain validation
  // -------------------------------------------------------------------------

  if (!input.fullName.trim()) {
    return validationError('Full name is required.', 'fullName')
  }

  if (!input.cpf && !input.internalRef) {
    return validationError(
      'Either CPF or an internal reference number must be provided.',
      'cpf'
    )
  }

  let normalizedCpf: string | undefined
  if (input.cpf) {
    const cpfResult = validateAndNormalizeCpf(input.cpf)
    if (!cpfResult.valid) {
      return validationError(
        cpfResult.reason === 'invalid_format'
          ? 'CPF must be 11 digits.'
          : 'CPF checksum is invalid. Please verify the number.',
        'cpf'
      )
    }
    normalizedCpf = cpfResult.normalized
  }

  const lawyerUserId = input.responsibleLawyerUserId ?? ctx.userId

  // -------------------------------------------------------------------------
  // 2. Duplicate CPF check (pre-transaction read)
  // -------------------------------------------------------------------------

  if (normalizedCpf) {
    const existingResult = await findClientByCpf(ctx.db, ctx.organizationId, normalizedCpf)
    if (!existingResult.success) {
      return internalServiceError('Failed to check CPF uniqueness.', existingResult.error.cause)
    }
    if (existingResult.data !== null) {
      return conflictError(
        'A client with this CPF already exists in the organization. Use the merge workflow to consolidate duplicate records.'
      )
    }
  }

  // -------------------------------------------------------------------------
  // 3. Transactional write
  // -------------------------------------------------------------------------

  try {
    const client = await withTx(ctx.db, async (tx) => {
      const now = new Date()

      const insertResult = unwrapOrThrow(
        await insertClient(tx, {
          organizationId: ctx.organizationId,
          fullName: input.fullName.trim(),
          cpf: normalizedCpf,
          rg: input.rg?.trim(),
          matricula: input.matricula?.trim(),
          birthDate: input.birthDate,
          displayName: input.displayName?.trim(),
          aliases: input.aliases ?? [],
          internalRef: input.internalRef?.trim(),
          responsibleLawyerUserId: lawyerUserId,
          contactChannels: input.contactChannels,
          notes: input.notes?.trim(),
          status: 'active',
          createdAt: now,
          createdByUserId: ctx.userId,
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
        entityType: 'Client',
        entityId: insertResult.id,
        changes: { type: 'creation', snapshot: { status: 'active', fullName: input.fullName.trim() } },
        eventType: 'client.created',
        aggregateType: 'Client',
        aggregateId: insertResult.id,
        occurredAt: now,
        eventPayload: {
          clientId: insertResult.id,
          organizationId: ctx.organizationId,
          status: 'active',
          hasCpf: !!normalizedCpf,
          createdByUserId: ctx.userId,
        },
      })

      return insertResult
    })

    return ok(client)
  } catch (err) {
    if (err instanceof Error && err.message.includes('clients_org_cpf_unique')) {
      return conflictError('A client with this CPF already exists in the organization.')
    }

    console.error('[client.service] createClient failed:', err)
    return internalServiceError('Failed to create client.', err)
  }
}

/**
 * Update an existing client.
 */
export async function updateClient(
  ctx: WriteContext,
  clientId: string,
  input: UpdateClientInput
): Promise<ServiceResult<Client>> {
  if (input.fullName !== undefined && !input.fullName.trim()) {
    return validationError('Full name is required.', 'fullName')
  }

  let normalizedCpf: string | undefined
  if (input.cpf) {
    const cpfResult = validateAndNormalizeCpf(input.cpf)
    if (!cpfResult.valid) {
      return validationError(
        cpfResult.reason === 'invalid_format'
          ? 'CPF must be 11 digits.'
          : 'CPF checksum is invalid. Please verify the number.',
        'cpf'
      )
    }
    normalizedCpf = cpfResult.normalized
  }

  try {
    const client = await withTx(ctx.db, async (tx) => {
      // Import updateClient locally or from top
      const { updateClient: repoUpdateClient } = await import('../repositories/client.ts')

      const updateData: any = {}
      if (input.fullName !== undefined) updateData.fullName = input.fullName.trim()
      if (normalizedCpf !== undefined) updateData.cpf = normalizedCpf
      if (input.rg !== undefined) updateData.rg = input.rg.trim()
      if (input.matricula !== undefined) updateData.matricula = input.matricula.trim()
      if (input.birthDate !== undefined) updateData.birthDate = input.birthDate
      if (input.displayName !== undefined) updateData.displayName = input.displayName.trim()
      if (input.aliases !== undefined) updateData.aliases = input.aliases
      if (input.internalRef !== undefined) updateData.internalRef = input.internalRef.trim()
      if (input.responsibleLawyerUserId !== undefined) updateData.responsibleLawyerUserId = input.responsibleLawyerUserId
      if (input.contactChannels !== undefined) updateData.contactChannels = input.contactChannels
      if (input.notes !== undefined) updateData.notes = input.notes.trim()

      const now = new Date()
      updateData.updatedAt = now

      const updateResult = unwrapOrThrow(
        await repoUpdateClient(tx, ctx.organizationId, clientId, updateData)
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'updated',
        entityType: 'Client',
        entityId: clientId,
        changes: { type: 'field_update' as const, fields: Object.fromEntries(
          Object.entries(updateData).map(([k, v]) => [k, { previous: null, next: v }])
        ) },
        eventType: 'client.updated',
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: now,
        eventPayload: {
          clientId,
          organizationId: ctx.organizationId,
        },
      })

      return updateResult
    })

    return ok(client)
  } catch (err) {
    if (err instanceof Error && err.message.includes('clients_org_cpf_unique')) {
      return conflictError('A client with this CPF already exists in the organization.')
    }
    if (err instanceof Error && err.message === 'NOT_FOUND') {
       return validationError('Client not found')
    }
    console.error('[client.service] updateClient failed:', err)
    return internalServiceError('Failed to update client.', err)
  }
}
