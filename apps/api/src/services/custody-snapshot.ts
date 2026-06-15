/**
 * CustodySnapshot service — propose → confirm → supersede lifecycle.
 *
 * APPEND-ONLY: custody state is set at INSERT; confirm/supersede update lifecycle only.
 */

import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { findCaseById } from '../repositories/execution-case.ts'
import {
  findCustodySnapshotById,
  insertCustodySnapshot,
  confirmCustodySnapshotRow,
  markCustodySnapshotSuperseded,
} from '../repositories/custody-snapshot.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import {
  ok,
  validationError,
  notFoundError,
  internalServiceError,
  fromRepositoryError,
} from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import type { CustodySnapshot } from '@execflow/db/schema'
import type { ConfidenceLevel } from '@execflow/db/types'
import { TxRepositoryError } from '../lib/tx.ts'

const REGIMES = [
  'fechado',
  'semiaberto',
  'aberto',
  'albergue',
  'domiciliar',
  'provisorio',
  'unknown',
] as const

export type ProposeCustodySnapshotInput = {
  effectiveAt: string
  regime: (typeof REGIMES)[number]
  prisonUnitId?: string | undefined
  confidence?: ConfidenceLevel | undefined
  sourceEventId?: string | undefined
  notes?: string | undefined
  amendsSnapshotId?: string | undefined
}

export type SupersedeCustodySnapshotInput = ProposeCustodySnapshotInput & {
  reason: string
}

function parseEffectiveAt(value: string): Date | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function proposeCustodySnapshot(
  ctx: WriteContext,
  executionCaseId: string,
  input: ProposeCustodySnapshotInput
): Promise<ServiceResult<CustodySnapshot>> {
  const effectiveAt = parseEffectiveAt(input.effectiveAt)
  if (effectiveAt === null) {
    return validationError('effectiveAt must be a valid ISO 8601 datetime.', 'effectiveAt')
  }

  if (!REGIMES.includes(input.regime)) {
    return validationError(`Invalid regime: ${input.regime}`, 'regime')
  }

  const caseResult = await findCaseById(ctx.db, ctx.organizationId, executionCaseId)
  if (!caseResult.success) {
    return notFoundError('Execution case not found.')
  }

  try {
    const snapshot = await withTx(ctx.db, async (tx) => {
      const row = unwrapOrThrow(
        await insertCustodySnapshot(tx, {
          organizationId: ctx.organizationId,
          executionCaseId,
          regime: input.regime,
          prisonUnitId: input.prisonUnitId,
          effectiveAt,
          confidence: input.confidence ?? 'medium',
          sourceEventId: input.sourceEventId,
          notes: input.notes,
          amendsSnapshotId: input.amendsSnapshotId,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'CustodySnapshot',
        entityId: row.id,
        changes: {
          type: 'creation',
          snapshot: { regime: input.regime, executionCaseId },
        },
        eventType: 'custody.snapshot.proposed',
        aggregateType: 'CustodySnapshot',
        aggregateId: row.id,
        occurredAt: effectiveAt,
        eventPayload: {
          snapshotId: row.id,
          custodySnapshotId: row.id,
          executionCaseId,
          organizationId: ctx.organizationId,
          regime: input.regime,
          effectiveAt: effectiveAt.toISOString(),
          confirmed: false,
        },
      })

      return row
    })

    return ok(snapshot)
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[custody-snapshot.service] proposeCustodySnapshot failed:', err)
    return internalServiceError('Failed to propose custody snapshot.', err)
  }
}

export async function confirmCustodySnapshot(
  ctx: WriteContext,
  snapshotId: string
): Promise<ServiceResult<CustodySnapshot>> {
  const existing = await findCustodySnapshotById(ctx.db, ctx.organizationId, snapshotId)
  if (!existing.success) {
    return notFoundError('Custody snapshot not found.')
  }
  if (existing.data.confirmedByUserId !== null) {
    return validationError('Custody snapshot is already confirmed.', 'status')
  }
  if (existing.data.supersededAt !== null) {
    return validationError('Superseded custody snapshots cannot be confirmed.', 'status')
  }

  const confirmedAt = new Date()

  try {
    const snapshot = await withTx(ctx.db, async (tx) => {
      const row = unwrapOrThrow(
        await confirmCustodySnapshotRow(tx, ctx.organizationId, snapshotId, {
          confirmedByUserId: ctx.userId,
          confirmedAt,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'confirmed',
        entityType: 'CustodySnapshot',
        entityId: row.id,
        changes: {
          type: 'state_transition',
          previous: 'proposed',
          next: 'confirmed',
        },
        eventType: 'custody.snapshot.created',
        aggregateType: 'CustodySnapshot',
        aggregateId: row.id,
        occurredAt: row.effectiveAt,
        eventPayload: {
          snapshotId: row.id,
          custodySnapshotId: row.id,
          executionCaseId: row.executionCaseId,
          organizationId: ctx.organizationId,
          regime: row.regime,
          effectiveAt: row.effectiveAt.toISOString(),
          confirmedByUserId: ctx.userId,
        },
      })

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'confirmed',
        entityType: 'CustodySnapshot',
        entityId: row.id,
        changes: {
          type: 'confirmation',
          snapshot: { regime: row.regime },
        },
        eventType: 'snapshot.confirmed',
        aggregateType: 'CustodySnapshot',
        aggregateId: row.id,
        occurredAt: confirmedAt,
        eventPayload: {
          snapshotId: row.id,
          snapshotKind: 'custody',
          executionCaseId: row.executionCaseId,
          organizationId: ctx.organizationId,
          effectiveAt: row.effectiveAt.toISOString(),
          confirmedByUserId: ctx.userId,
        },
      })

      return row
    })

    return ok(snapshot)
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[custody-snapshot.service] confirmCustodySnapshot failed:', err)
    return internalServiceError('Failed to confirm custody snapshot.', err)
  }
}

export async function supersedeCustodySnapshot(
  ctx: WriteContext,
  snapshotId: string,
  input: SupersedeCustodySnapshotInput
): Promise<ServiceResult<{ superseded: CustodySnapshot; replacement: CustodySnapshot }>> {
  const existing = await findCustodySnapshotById(ctx.db, ctx.organizationId, snapshotId)
  if (!existing.success) {
    return notFoundError('Custody snapshot not found.')
  }
  if (existing.data.confirmedByUserId === null) {
    return validationError('Only confirmed custody snapshots can be superseded.', 'status')
  }
  if (existing.data.supersededAt !== null) {
    return validationError('Custody snapshot is already superseded.', 'status')
  }

  if (!input.reason.trim()) {
    return validationError('reason is required for supersede.', 'reason')
  }

  const effectiveAt = parseEffectiveAt(input.effectiveAt)
  if (effectiveAt === null) {
    return validationError('effectiveAt must be a valid ISO 8601 datetime.', 'effectiveAt')
  }

  if (!REGIMES.includes(input.regime)) {
    return validationError(`Invalid regime: ${input.regime}`, 'regime')
  }

  const executionCaseId = existing.data.executionCaseId
  const supersededAt = new Date()

  try {
    const result = await withTx(ctx.db, async (tx) => {
      const replacement = unwrapOrThrow(
        await insertCustodySnapshot(tx, {
          organizationId: ctx.organizationId,
          executionCaseId,
          regime: input.regime,
          prisonUnitId: input.prisonUnitId ?? existing.data.prisonUnitId,
          effectiveAt,
          confidence: input.confidence ?? existing.data.confidence,
          sourceEventId: input.sourceEventId ?? existing.data.sourceEventId,
          notes: input.notes ?? existing.data.notes,
          amendsSnapshotId: snapshotId,
        })
      )

      const superseded = unwrapOrThrow(
        await markCustodySnapshotSuperseded(tx, ctx.organizationId, snapshotId, {
          supersededAt,
          supersededBySnapshotId: replacement.id,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'status_changed',
        entityType: 'CustodySnapshot',
        entityId: superseded.id,
        changes: {
          type: 'state_transition',
          previous: 'confirmed',
          next: 'superseded',
        },
        eventType: 'custody.snapshot.superseded',
        aggregateType: 'CustodySnapshot',
        aggregateId: superseded.id,
        occurredAt: supersededAt,
        eventPayload: {
          snapshotId: superseded.id,
          supersededSnapshotId: superseded.id,
          replacementSnapshotId: replacement.id,
          executionCaseId,
          organizationId: ctx.organizationId,
          reason: input.reason.trim(),
        },
      })

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'CustodySnapshot',
        entityId: replacement.id,
        changes: {
          type: 'creation',
          snapshot: { regime: input.regime, amendsSnapshotId: snapshotId },
        },
        eventType: 'custody.snapshot.proposed',
        aggregateType: 'CustodySnapshot',
        aggregateId: replacement.id,
        occurredAt: effectiveAt,
        eventPayload: {
          snapshotId: replacement.id,
          custodySnapshotId: replacement.id,
          executionCaseId,
          organizationId: ctx.organizationId,
          regime: input.regime,
          amendsSnapshotId: snapshotId,
        },
      })

      return { superseded, replacement }
    })

    return ok(result)
  } catch (err) {
    if (err instanceof TxRepositoryError) {
      return fromRepositoryError(err.code, err.message, err.rootCause)
    }
    console.error('[custody-snapshot.service] supersedeCustodySnapshot failed:', err)
    return internalServiceError('Failed to supersede custody snapshot.', err)
  }
}

export { REGIMES as CUSTODY_REGIMES }
