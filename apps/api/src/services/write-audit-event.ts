/**
 * Shared helper: write AuditLog + DomainEvent in one transactional call.
 *
 * This is the single integration point between domain service operations and
 * the audit/event infrastructure. Every meaningful mutation in EXECFLOW:
 * 1. Writes the business entity change (via repository)
 * 2. Calls writeAuditAndEvent() in the SAME transaction
 *
 * ARCHITECTURE REQUIREMENT:
 * These two writes MUST be co-committed with the business entity write.
 * Use this function inside db.transaction() alongside the entity insert/update.
 * A domain event that is written but the entity write fails = inconsistency.
 * Architecture ref: AuditLog schema "WRITE CONTRACT", event-state-architecture.md §4.1.
 *
 * CAUSALITY PROPAGATION:
 * The causationId and correlationId from the WriteContext are forwarded to
 * the DomainEvent. When the event triggers further operations (async consumers),
 * those operations set their causationId = this event's id, and preserve correlationId.
 * Architecture ref: event-state-architecture.md §1.6.
 */

import { writeAuditLog } from '../repositories/audit.ts'
import { writeDomainEvent } from '../repositories/domain-event.ts'
import type { DbTransaction } from '../lib/db.ts'
import type { RequestActor } from '@execflow/auth/types'
import type { AuditChanges, AuditMetadata } from '@execflow/db/types'

/**
 * Parameters for a combined audit + domain event write.
 * Built by service functions using WriteContext + operation-specific data.
 */
export type AuditEventParams = {
  // -------------------------------------------------------------------------
  // Transaction context
  // -------------------------------------------------------------------------
  tx: DbTransaction

  // -------------------------------------------------------------------------
  // Actor attribution (from WriteContext.actor)
  // -------------------------------------------------------------------------
  actor: RequestActor
  organizationId: string
  requestId: string

  // -------------------------------------------------------------------------
  // Causality chain
  // -------------------------------------------------------------------------
  /**
   * The domain_event.id that caused this operation (null for human-initiated).
   * Architecture ref: event-state-architecture.md §1.6.
   */
  causationId?: string | null

  /**
   * Shared across all events in one logical operation.
   * For HTTP-initiated: same as requestId. For derived: propagated from parent.
   */
  correlationId: string

  // -------------------------------------------------------------------------
  // AuditLog fields
  // -------------------------------------------------------------------------
  /** Past-tense verb: 'created', 'confirmed', 'status_changed', etc. */
  action: string
  /** PascalCase entity type: 'Client', 'ExecutionCase', 'Document', etc. */
  entityType: string
  /** UUID of the affected entity. */
  entityId: string
  /** Structured before/after data. */
  changes?: AuditChanges | null
  /** Additional metadata for the audit entry. */
  auditMetadata?: AuditMetadata | null

  // -------------------------------------------------------------------------
  // DomainEvent fields
  // -------------------------------------------------------------------------
  /**
   * Namespaced event type: 'client.created', 'case.created', 'document.registered', etc.
   * Architecture ref: event-state-architecture.md §2.1 (event taxonomy).
   */
  eventType: string
  /** PascalCase aggregate type: 'Client', 'ExecutionCase', etc. */
  aggregateType: string
  /** UUID of the aggregate root instance. */
  aggregateId: string
  /**
   * Legal time of the event (may differ from system time for retroactive recording).
   * For most service operations: use new Date() (the operation is happening now).
   * For retroactive recording: use the actual legal date.
   */
  occurredAt: Date
  /** Self-contained event payload. Consumers must not need to join other tables. */
  eventPayload: Record<string, unknown>
  /**
   * Whether this event should be included in replay operations.
   * Default: true. Set to false for notification-only events.
   */
  replayable?: boolean
}

/**
 * Write both an AuditLog entry and a DomainEvent within the same transaction.
 * Both writes are atomic — if either fails, both are rolled back with the transaction.
 *
 * IMPORTANT: Call this ONLY inside a db.transaction() callback.
 * Passing a plain DbClient here is an architecture defect.
 */
export async function writeAuditAndEvent(params: AuditEventParams): Promise<void> {
  const {
    tx,
    actor,
    organizationId,
    requestId,
    causationId,
    correlationId,
    action,
    entityType,
    entityId,
    changes,
    auditMetadata,
    eventType,
    aggregateType,
    aggregateId,
    occurredAt,
    eventPayload,
    replayable = true,
  } = params

  // Build audit metadata
  const metadata: AuditMetadata = {
    requestId,
    ...(causationId ? { triggerEventId: causationId } : {}),
    ...auditMetadata,
  }

  // Write AuditLog (immutable, append-only)
  const auditResult = await writeAuditLog(tx, {
    organizationId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    impersonatingUserId: actor.impersonatingUserId,
    action,
    entityType,
    entityId,
    changes: changes ?? null,
    metadata,
    sessionId: actor.sessionToken,
    ipAddress: actor.ipAddress,
    requestId,
  })

  if (!auditResult.success) {
    // Throw to trigger transaction rollback
    throw new Error(`AuditLog write failed: ${auditResult.error.message}`)
  }

  // Write DomainEvent (transactional outbox)
  const eventResult = await writeDomainEvent(tx, {
    eventType,
    aggregateType,
    aggregateId,
    causationId: causationId ?? null,
    correlationId,
    organizationId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    occurredAt,
    payload: eventPayload,
    metadata: { requestId },
    replayable,
    processingStatus: 'pending',
  })

  if (!eventResult.success) {
    throw new Error(`DomainEvent write failed: ${eventResult.error.message}`)
  }
}
