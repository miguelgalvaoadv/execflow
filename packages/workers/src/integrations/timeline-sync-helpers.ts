/**
 * Shared timeline/domain-event helpers used by every court-monitoring source
 * (Jusbrasil during the transition, Astrea going forward). Extracted from
 * crawler-sync.ts so both pipelines write to timelineEvents/domainEvents the
 * same way — same dedup rule, same payload shape.
 */

import { domainEvents, executionCases, timelineEvents } from '@execflow/db/schema'
import { eq, and } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'

export type UpsertTimelineEventInput = {
  eventCategory: string
  eventType: string
  occurredAt: Date
  summary: string
  actorId: string
  /** Polymorphic pointer to the record that produced this event (e.g. an astrea_email_logs row). */
  sourceRefType?: string
  sourceRefId?: string
}

/**
 * Inserts a timeline event with dedup by (case, source='integration', summary).
 * Returns true if a new row was created, false if it already existed.
 *
 * This is the SAME dedup rule used by every integration source — it is
 * intentionally a simple exact-string match. Callers that need stronger
 * idempotency (e.g. Astrea email ingestion) MUST de-duplicate at their own
 * layer first (Message-ID / content hash) and only call this once they know
 * the source record is new.
 */
export async function upsertTimelineEvent(
  db: WorkersDb,
  organizationId: string,
  executionCaseId: string,
  ev: UpsertTimelineEventInput
): Promise<boolean> {
  const existing = await db
    .select({ id: timelineEvents.id })
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.executionCaseId, executionCaseId),
        eq(timelineEvents.source, 'integration'),
        eq(timelineEvents.summary, ev.summary)
      )
    )
    .limit(1)
  if (existing.length > 0) return false

  await db.insert(timelineEvents).values({
    organizationId,
    executionCaseId,
    eventCategory: ev.eventCategory as any,
    eventType: ev.eventType,
    occurredAt: ev.occurredAt,
    summary: ev.summary,
    source: 'integration',
    actorType: 'system',
    actorId: ev.actorId,
    ...(ev.sourceRefType ? { sourceRefType: ev.sourceRefType } : {}),
    ...(ev.sourceRefId ? { sourceRefId: ev.sourceRefId } : {}),
  })
  return true
}

/**
 * Emits the case.movements.received domain event — same payload shape
 * regardless of which integration produced the movements.
 */
export async function emitMovementsReceived(
  db: WorkersDb,
  execCase: typeof executionCases.$inferSelect,
  organizationId: string,
  newEventsCount: number,
  source: string,
  requestedByUserId?: string
) {
  await db.insert(domainEvents).values({
    id: crypto.randomUUID(),
    organizationId,
    eventType: 'case.movements.received',
    aggregateId: execCase.id,
    aggregateType: 'execution_case',
    correlationId: crypto.randomUUID(),
    actorType: 'system',
    actorId: requestedByUserId || `${source}`,
    occurredAt: new Date(),
    recordedAt: new Date(),
    payload: {
      executionCaseId: execCase.id,
      cnj: execCase.executionProcessNumber,
      newEventsCount,
      source,
    },
    metadata: { source },
    causationId: null,
    processingStatus: 'pending',
    replayable: true,
  })
}
