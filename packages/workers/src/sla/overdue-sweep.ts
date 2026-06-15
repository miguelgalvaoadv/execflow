/**
 * SLA overdue sweep — detects deadlines past their due_at and transitions them.
 *
 * RUN FREQUENCY: Every 5 minutes (via pg-boss cron schedule).
 *
 * WHAT IT DOES:
 * 1. Finds deadlines WHERE status = 'open' AND due_at < NOW()
 * 2. For each: updates status to 'overdue', writes DeadlineHistory, fires DomainEvent
 * 3. Updates/creates queue projection in overdue_deadlines queue
 *
 * IDEMPOTENCY:
 * - The DeadlineHistory write uses the deadline's current status to detect
 *   if the transition was already applied (status != 'open' → skip).
 * - The QueueProjection upsert is idempotent by natural key.
 *
 * TRANSACTIONAL INTEGRITY:
 * Each deadline's transition is a separate transaction. If one fails, the others
 * are not affected. A failed transition will be retried in the next sweep cycle.
 *
 * NOTE ON SYSTEM ACTOR:
 * The SLA sweep runs as a system actor. Actor attribution is:
 *   actorType = 'system', actorId = 'sla-monitor.overdue-sweep'
 *
 * Architecture ref: event-state-architecture.md §3.5 (deadline state machine),
 *                   office-operating-system.md §6.1 (missed deadline prevention).
 */

import { sql, and, lt, eq } from '@execflow/db/client'
import { randomUUID } from 'node:crypto'
import type { WorkersDb } from '../lib/db.ts'
import {
  upsertQueueProjection,
} from '../projections/queue-projection.ts'
import {
  DEADLINE_HISTORY_SYSTEM_ACTOR_OVERDUE_SWEEP,
  deadlineHistorySystemActor,
} from '@execflow/db/types'
const BATCH_SIZE = 100

/**
 * One execution of the overdue sweep.
 * Finds and transitions all newly-overdue deadlines.
 */
export async function runOverdueSweep(db: WorkersDb): Promise<void> {
  const {
    deadlines,
    deadlineHistory,
    domainEvents,
  } = await import('@execflow/db/schema')

  const now = new Date()

  const overdueDeadlines = await db
    .select({
      id: deadlines.id,
      organizationId: deadlines.organizationId,
      executionCaseId: deadlines.executionCaseId,
      title: deadlines.title,
      deadlineClass: deadlines.deadlineClass,
      priority: deadlines.priority,
      dueAt: deadlines.dueAt,
      assigneeUserId: deadlines.assigneeUserId,
      escalationLevel: deadlines.escalationLevel,
    })
    .from(deadlines)
    .where(
      and(
        eq(deadlines.status, 'open'),
        lt(deadlines.dueAt, now)
      )
    )
    .limit(BATCH_SIZE)

  if (overdueDeadlines.length === 0) return

  console.info(`[overdue-sweep] Processing ${overdueDeadlines.length} newly-overdue deadlines`)

  for (const deadline of overdueDeadlines) {
    try {
      await transitionDeadlineToOverdue(db, deadline, now)
    } catch (err) {
      console.error(`[overdue-sweep] Failed to transition deadline ${deadline.id}:`, err)
    }
  }
}

async function transitionDeadlineToOverdue(
  db: WorkersDb,
  deadline: {
    id: string
    organizationId: string
    executionCaseId: string | null
    title: string
    deadlineClass: 'legal' | 'benefit' | 'disciplinary' | 'calculation' | 'internal' | 'recurring' | 'sla'
    priority: 'critical' | 'high' | 'normal' | 'low'
    dueAt: Date
    assigneeUserId: string | null
    escalationLevel: number
  },
  now: Date
): Promise<void> {
  const {
    deadlines,
    deadlineHistory,
    domainEvents,
  } = await import('@execflow/db/schema')

  const correlationId = randomUUID()
  const eventId = randomUUID()

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(deadlines)
      .set({
        status: 'overdue',
        updatedAt: now,
      })
      .where(
        and(
          eq(deadlines.id, deadline.id),
          eq(deadlines.status, 'open')
        )
      )
      .returning({ id: deadlines.id })

    if (updated.length === 0) {
      return
    }

    await tx.insert(domainEvents).values({
      id: eventId,
      eventType: 'deadline.overdue',
      aggregateType: 'Deadline',
      aggregateId: deadline.id,
      organizationId: deadline.organizationId,
      actorType: 'system',
      actorId: DEADLINE_HISTORY_SYSTEM_ACTOR_OVERDUE_SWEEP,
      occurredAt: now,
      recordedAt: now,
      correlationId,
      payload: {
        deadlineId: deadline.id,
        title: deadline.title,
        deadlineClass: deadline.deadlineClass,
        priority: deadline.priority,
        dueAt: deadline.dueAt.toISOString(),
        ...(deadline.executionCaseId ? { executionCaseId: deadline.executionCaseId } : {}),
        ...(deadline.assigneeUserId ? { assigneeUserId: deadline.assigneeUserId } : {}),
      },
      processingStatus: 'pending',
    })

    await tx.insert(deadlineHistory).values({
      organizationId: deadline.organizationId,
      deadlineId: deadline.id,
      changeType: 'status_changed',
      previousValue: { status: 'open' },
      newValue: { status: 'overdue' },
      reason: 'SLA monitor: due_at passed without completion',
      ...deadlineHistorySystemActor(DEADLINE_HISTORY_SYSTEM_ACTOR_OVERDUE_SWEEP),
      changedAt: now,
      causingEventId: eventId,
      correlationId,
    })
  })

  await upsertQueueProjection(db, {
    organizationId: deadline.organizationId,
    queueType: 'overdue_deadlines',
    entityType: 'Deadline',
    entityId: deadline.id,
    ...(deadline.executionCaseId !== null ? { executionCaseId: deadline.executionCaseId } : {}),
    priority: 0,
    displayTitle: deadline.title,
    displayLabel: deadline.deadlineClass,
    keyDate: deadline.dueAt,
    ...(deadline.assigneeUserId !== null ? { assigneeUserId: deadline.assigneeUserId } : {}),
    sourceCausingEventId: eventId,
    metadata: {
      deadlineClass: deadline.deadlineClass,
      deadlinePriority: deadline.priority,
      isOverdue: true,
      dueAt: deadline.dueAt.toISOString(),
    },
  })
}

/**
 * Wakes up snoozed queue projections whose snooze_until has passed.
 */
export async function runSnoozeWake(db: WorkersDb): Promise<void> {
  const { queueProjections } = await import('@execflow/db/schema')

  const now = new Date()

  await db
    .update(queueProjections)
    .set({ status: 'active', snoozeUntil: null, updatedAt: now })
    .where(
      sql`
        status = 'snoozed'
        AND snooze_until IS NOT NULL
        AND snooze_until <= ${now.toISOString()}
      `
    )
}

/**
 * Wakes up deferred queue projections whose deferred_until has passed.
 */
export async function runDeferWake(db: WorkersDb): Promise<void> {
  const { queueProjections } = await import('@execflow/db/schema')

  const now = new Date()

  await db
    .update(queueProjections)
    .set({ status: 'active', deferredUntil: null, updatedAt: now })
    .where(
      sql`
        status = 'deferred'
        AND deferred_until IS NOT NULL
        AND deferred_until <= ${now.toISOString()}
      `
    )
}
