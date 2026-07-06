/**
 * Event consumers for Deadline domain events.
 *
 * REGISTERED CONSUMERS:
 * - deadline.created       → create queue projection; maybe create task
 * - deadline.acknowledged  → update queue projection metadata
 * - deadline.completed     → resolve queue projection
 * - deadline.dismissed     → resolve queue projection
 * - deadline.overdue       → move to overdue_deadlines queue; escalate priority
 *
 * IDEMPOTENCY:
 * Each handler is idempotent. Processing the same event twice produces the
 * same outcome (via upsert on queue_projections natural key, and causingEventId
 * guard on workflow_tasks).
 *
 * HANDLER STRUCTURE:
 * Each handler receives a pg-boss job with data:
 *   { eventId, eventType, payload, occurredAt, organizationId, correlationId }
 * The payload is the specific event payload written by the service layer.
 *
 * Architecture ref: event-state-architecture.md §2.6 (event consumers),
 *                   office-operating-system.md §2.1 (queue catalog).
 */

import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import {
  upsertQueueProjection,
  resolveQueueProjection,
} from '../projections/queue-projection.ts'
import { maybeCreateDeadlineActionTask } from '../projections/workflow-task.ts'
import { sendWhatsappDeadlineReminder } from '../sla/whatsapp.ts'

type DeadlineEventJob = Job<{
  eventId: string
  eventType: string
  payload: Record<string, unknown>
  occurredAt: string
  organizationId: string | null
  correlationId: string
  causationId: string | null
}>

/**
 * Derives the operational priority (0-3) from deadline priority + class.
 */
function deriveQueuePriority(
  deadlinePriority: string,
  deadlineClass: string
): number {
  if (deadlinePriority === 'critical') return 0
  if (deadlinePriority === 'high') return 1
  if (deadlineClass === 'legal') return 1
  if (deadlinePriority === 'normal') return 2
  return 3
}

/**
 * Computes SLA deadline for a queue projection.
 * For legal deadlines: queue SLA = due_at - 24h (must act before legal due)
 * For other deadlines: queue SLA = due_at itself
 */
function computeQueueSla(
  dueAt: string | undefined,
  deadlineClass: string
): Date | undefined {
  if (!dueAt) return undefined
  const dueDate = new Date(dueAt)
  if (deadlineClass === 'legal') {
    return new Date(dueDate.getTime() - 24 * 60 * 60 * 1000)
  }
  return dueDate
}

/**
 * Handles deadline.created events.
 *
 * QUEUE ROUTING:
 * - Legal/critical deadlines: workflow_tasks queue (tracking + task creation)
 * - All deadlines: tracked in workflow_tasks queue for assignee views
 *
 * Note: deadlines only enter overdue_deadlines queue when they become overdue
 * (via deadline.overdue event or SLA sweep). Not at creation time.
 */
export async function handleDeadlineCreated(
  db: WorkersDb,
  job: DeadlineEventJob
): Promise<void> {
  const { payload, organizationId, eventId } = job.data

  if (!organizationId) return

  const deadlineId = payload['deadlineId'] as string | undefined
  const title = payload['title'] as string | undefined
  const deadlineClass = (payload['deadlineClass'] as string | undefined) ?? 'internal'
  const priority = (payload['priority'] as string | undefined) ?? 'normal'
  const dueAt = payload['dueAt'] as string | undefined
  const assigneeUserId = payload['assigneeUserId'] as string | undefined
  const executionCaseId = payload['executionCaseId'] as string | undefined

  if (!deadlineId || !title) return

  const queuePriority = deriveQueuePriority(priority, deadlineClass)
  const slaDeadlineAt = computeQueueSla(dueAt, deadlineClass)

  await upsertQueueProjection(db, {
    organizationId,
    queueType: 'workflow_tasks',
    entityType: 'Deadline',
    entityId: deadlineId,
    ...(executionCaseId !== undefined ? { executionCaseId } : {}),
    priority: queuePriority,
    displayTitle: title,
    displayLabel: deadlineClass,
    ...(dueAt !== undefined ? { keyDate: new Date(dueAt) } : {}),
    ...(slaDeadlineAt !== undefined ? { slaDeadlineAt } : {}),
    ...(assigneeUserId !== undefined ? { assigneeUserId } : {}),
    sourceCausingEventId: eventId,
    metadata: { deadlineClass, deadlinePriority: priority },
  })

  await maybeCreateDeadlineActionTask(db, {
    organizationId,
    executionCaseId: executionCaseId,
    deadlineId,
    deadlineTitle: title,
    deadlineClass,
    deadlinePriority: priority,
    dueAt: dueAt ? new Date(dueAt) : new Date(),
    causingEventId: eventId,
    correlationId: job.data.correlationId,
    createdBySystemActorId: 'worker.deadline-consumer',
  })

  if (dueAt && executionCaseId) {
    const { domainEvents } = await import('@execflow/db/schema')
    const crypto = await import('crypto')
    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      eventType: 'whatsapp.notification.requested',
      aggregateType: 'ExecutionCase',
      aggregateId: executionCaseId,
      actorType: 'system',
      actorId: 'worker.deadline-consumer',
      payload: {
        notificationType: 'deadline_alert',
        executionCaseId,
        deadlineTitle: title,
        dueAt,
        status: 'warning',
      },
      correlationId: job.data.correlationId,
      causationId: eventId,
      occurredAt: new Date(),
    })
  }
}

/**
 * Handles deadline.acknowledged events.
 * Updates queue metadata to reflect acknowledgment (reduces priority slightly
 * for non-overdue acknowledged deadlines — acknowledged but not yet done).
 */
export async function handleDeadlineAcknowledged(
  db: WorkersDb,
  job: DeadlineEventJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const deadlineId = payload['deadlineId'] as string | undefined
  const title = payload['title'] as string | undefined

  if (!deadlineId) return

  await upsertQueueProjection(db, {
    organizationId,
    queueType: 'workflow_tasks',
    entityType: 'Deadline',
    entityId: deadlineId,
    priority: 2,
    displayTitle: title ?? 'Prazo',
    metadata: { acknowledged: true },
  })
}

/**
 * Handles deadline.completed events.
 * Resolves ALL queue projections for this deadline.
 * The deadline has exited all queues.
 */
export async function handleDeadlineCompleted(
  db: WorkersDb,
  job: DeadlineEventJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const deadlineId = payload['deadlineId'] as string | undefined
  if (!deadlineId) return

  for (const queueType of ['workflow_tasks', 'overdue_deadlines'] as const) {
    await resolveQueueProjection(db, {
      organizationId,
      queueType,
      entityType: 'Deadline',
      entityId: deadlineId,
    })
  }
}

/**
 * Handles deadline.dismissed events.
 * Resolves ALL queue projections for this deadline.
 */
export async function handleDeadlineDismissed(
  db: WorkersDb,
  job: DeadlineEventJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const deadlineId = payload['deadlineId'] as string | undefined
  if (!deadlineId) return

  for (const queueType of ['workflow_tasks', 'overdue_deadlines'] as const) {
    await resolveQueueProjection(db, {
      organizationId,
      queueType,
      entityType: 'Deadline',
      entityId: deadlineId,
    })
  }
}

/**
 * Handles deadline.overdue events.
 *
 * QUEUE TRANSITION:
 * - Remove from workflow_tasks queue (or keep for tracking)
 * - CREATE/UPDATE entry in overdue_deadlines queue with priority 0 (interrupt)
 *
 * The overdue_deadlines queue is "all overdue obligations" per
 * office-operating-system.md §2.1.
 */
export async function handleDeadlineOverdue(
  db: WorkersDb,
  job: DeadlineEventJob
): Promise<void> {
  const { payload, organizationId, eventId } = job.data

  if (!organizationId) return

  const deadlineId = payload['deadlineId'] as string | undefined
  const title = payload['title'] as string | undefined
  const deadlineClass = (payload['deadlineClass'] as string | undefined) ?? 'internal'
  const assigneeUserId = payload['assigneeUserId'] as string | undefined
  const executionCaseId = payload['executionCaseId'] as string | undefined
  const dueAt = payload['dueAt'] as string | undefined

  if (!deadlineId || !title) return

  await upsertQueueProjection(db, {
    organizationId,
    queueType: 'overdue_deadlines',
    entityType: 'Deadline',
    entityId: deadlineId,
    ...(executionCaseId !== undefined ? { executionCaseId } : {}),
    priority: 0,
    displayTitle: title,
    displayLabel: deadlineClass,
    ...(dueAt !== undefined ? { keyDate: new Date(dueAt) } : {}),
    ...(assigneeUserId !== undefined ? { assigneeUserId } : {}),
    sourceCausingEventId: eventId,
    metadata: { deadlineClass, isOverdue: true },
  })

  if (dueAt && executionCaseId) {
    const { domainEvents } = await import('@execflow/db/schema')
    const crypto = await import('crypto')
    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      eventType: 'whatsapp.notification.requested',
      aggregateType: 'ExecutionCase',
      aggregateId: executionCaseId,
      actorType: 'system',
      actorId: 'worker.deadline-consumer',
      payload: {
        notificationType: 'deadline_alert',
        executionCaseId,
        deadlineTitle: title,
        dueAt,
        status: 'overdue',
      },
      correlationId: job.data.correlationId,
      causationId: eventId,
      occurredAt: new Date(),
    })
  }
}
