/**
 * DomainEvent repository — transactional outbox write interface.
 *
 * Domain events are written to the outbox table in the SAME transaction
 * as the state change they represent. The outbox relay worker (future Phase 5+)
 * picks them up and publishes to the job queue for async consumers.
 *
 * TRANSACTION REQUIREMENT:
 * writeDomainEvent() MUST be called inside a transaction alongside the business
 * entity write. Writing a domain event outside a transaction is an architecture defect.
 * Architecture ref: event-state-architecture.md §4.1.
 *
 * CAUSALITY FIELDS:
 * - causationId: the domain_event.id that directly caused this event (null for human-initiated)
 * - correlationId: shared across all events in one operation chain
 * These fields are set by the caller using the WriteContext propagation rules.
 * Architecture ref: event-state-architecture.md §1.6.
 */

import { domainEvents } from '@execflow/db/schema'
import type { NewDomainEvent, DomainEvent } from '@execflow/db/schema'
import type { DbTransaction } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

/**
 * Append one domain event to the transactional outbox inside a transaction.
 *
 * @param tx   - Active database transaction. NEVER pass a plain DbClient here.
 * @param data - The domain event to append. Must include correlationId.
 * @returns    RepositoryResult containing the created event.
 */
export async function writeDomainEvent(
  tx: DbTransaction,
  data: NewDomainEvent
): Promise<RepositoryResult<DomainEvent>> {
  try {
    const [row] = await tx.insert(domainEvents).values(data).returning()
    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Domain event insert returned no rows.' },
      }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN',
        message: 'Failed to write domain event.',
        cause: err,
      },
    }
  }
}
