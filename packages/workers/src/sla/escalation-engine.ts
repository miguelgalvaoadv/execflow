/**
 * Escalation engine — detects SLA breaches and escalates queue items.
 *
 * RUN FREQUENCY: Every 10 minutes (via pg-boss cron schedule).
 *
 * ESCALATION LEVELS (per office-operating-system.md §1.6, §7.4):
 *   Level 0: No escalation — item is on track or snoozed
 *   Level 1: SLA breach detected → assignee notified
 *   Level 2: +N hours unresolved → responsible lawyer notified
 *   Level 3: +2N hours unresolved → admin/managing partner notified
 *
 * ESCALATION RULES:
 * - Items in overdue_deadlines queue: escalate immediately (level 1 on entry)
 * - Priority 0 (interrupt): 4h unacknowledged → level 2
 * - Priority 1 (today): 24h → level 2, 72h → level 3
 * - Priority 2 (week): 72h → level 2, 168h → level 3
 * - Priority 3 (background): 168h → level 2
 *
 * APPEND-ONLY HISTORY:
 * Each escalation writes an immutable QueueEscalation record.
 * The QueueProjection.escalation_level is updated to reflect current state.
 *
 * Architecture ref: office-operating-system.md §6.6, execution-workflows.md §4.5.
 */

import { and, lt, ne, sql, isNotNull } from '@execflow/db/client'
import { randomUUID } from 'node:crypto'
import type { WorkersDb } from '../lib/db.ts'
import {
  escalateQueueProjection,
  markQueueProjectionSlaBreached,
} from '../projections/queue-projection.ts'

const SYSTEM_ACTOR = 'sla-monitor.escalation-sweep'

/** Hours until escalation by priority level */
const ESCALATION_THRESHOLDS: Record<number, { toLevel2: number; toLevel3: number }> = {
  0: { toLevel2: 4, toLevel3: 8 },
  1: { toLevel2: 24, toLevel3: 72 },
  2: { toLevel2: 72, toLevel3: 168 },
  3: { toLevel2: 168, toLevel3: 336 },
}

/**
 * One execution of the escalation sweep.
 * Evaluates all active queue projections with SLA deadlines.
 */
export async function runEscalationSweep(db: WorkersDb): Promise<void> {
  const { queueProjections, queueEscalations } = await import('@execflow/db/schema')

  const now = new Date()

  const candidates = await db
    .select({
      id: queueProjections.id,
      organizationId: queueProjections.organizationId,
      queueType: queueProjections.queueType,
      entityType: queueProjections.entityType,
      entityId: queueProjections.entityId,
      priority: queueProjections.priority,
      escalationLevel: queueProjections.escalationLevel,
      slaDeadlineAt: queueProjections.slaDeadlineAt,
      slaBreachedAt: queueProjections.slaBreachedAt,
      createdAt: queueProjections.createdAt,
    })
    .from(queueProjections)
    .where(
      and(
        ne(queueProjections.status, 'resolved'),
        ne(queueProjections.status, 'snoozed'),
        isNotNull(queueProjections.slaDeadlineAt),
        lt(queueProjections.slaDeadlineAt, now)
      )
    )
    .limit(200)

  if (candidates.length === 0) return

  console.info(`[escalation-sweep] Evaluating ${candidates.length} SLA-breached items`)

  for (const item of candidates) {
    try {
      await processEscalationCandidate(db, item, now)
    } catch (err) {
      console.error(`[escalation-sweep] Failed to process ${item.id}:`, err)
    }
  }
}

async function processEscalationCandidate(
  db: WorkersDb,
  item: {
    id: string
    organizationId: string
    queueType: string
    entityType: string
    entityId: string
    priority: number
    escalationLevel: number
    slaDeadlineAt: Date | null
    slaBreachedAt: Date | null
    createdAt: Date
  },
  now: Date
): Promise<void> {
  const { queueEscalations } = await import('@execflow/db/schema')

  if (!item.slaDeadlineAt) return

  const breachedAt = item.slaBreachedAt ?? item.slaDeadlineAt
  const hoursSinceBreach = (now.getTime() - breachedAt.getTime()) / (1000 * 60 * 60)

  const thresholds = ESCALATION_THRESHOLDS[item.priority] ?? ESCALATION_THRESHOLDS[2]
  if (!thresholds) return

  let targetLevel = 1

  if (hoursSinceBreach >= thresholds.toLevel3) {
    targetLevel = 3
  } else if (hoursSinceBreach >= thresholds.toLevel2) {
    targetLevel = 2
  }

  if (targetLevel <= item.escalationLevel) return

  const correlationId = randomUUID()

  await markQueueProjectionSlaBreached(db, item.id, breachedAt)

  await escalateQueueProjection(db, {
    projectionId: item.id,
    newLevel: targetLevel,
    escalatedAt: now,
  })

  await db.insert(queueEscalations).values({
    organizationId: item.organizationId,
    targetEntityType: item.entityType,
    targetEntityId: item.entityId,
    trigger: 'sla_breach',
    previousLevel: item.escalationLevel,
    newLevel: targetLevel,
    escalationReason: `SLA breached: ${hoursSinceBreach.toFixed(1)}h past deadline`,
    breachedAt,
    slaBreach: {
      slaDeadlineAt: item.slaDeadlineAt.toISOString(),
      breachedAt: breachedAt.toISOString(),
      hoursSinceBreach: Math.round(hoursSinceBreach * 10) / 10,
    },
    actorType: 'system',
    actorId: SYSTEM_ACTOR,
    escalatedAt: now,
    correlationId,
  })

  console.info(
    `[escalation-sweep] Escalated ${item.entityType}:${item.entityId} ` +
    `to level ${targetLevel} (${hoursSinceBreach.toFixed(1)}h past SLA)`
  )
}

/**
 * Detects stale workflow tasks (no status update in N hours) and marks as escalated.
 * "Stale" = in 'pending' or 'in_progress' status with no activity past threshold.
 *
 * Architecture ref: office-operating-system.md §6.2 (stale case detection).
 */
export async function runStaleTaskSweep(db: WorkersDb): Promise<void> {
  const { workflowTasks, queueEscalations } = await import('@execflow/db/schema')

  const now = new Date()
  const staleThresholdHours = 48
  const staleThreshold = new Date(now.getTime() - staleThresholdHours * 60 * 60 * 1000)

  const staleTasks = await db
    .select({
      id: workflowTasks.id,
      organizationId: workflowTasks.organizationId,
      priority: workflowTasks.priority,
      status: workflowTasks.status,
      updatedAt: workflowTasks.updatedAt,
    })
    .from(workflowTasks)
    .where(
      sql`
        status IN ('pending', 'claimed', 'in_progress')
        AND updated_at < ${staleThreshold.toISOString()}
        AND escalated_at IS NULL
        AND due_at IS NOT NULL
        AND due_at < ${now.toISOString()}
      `
    )
    .limit(50)

  if (staleTasks.length === 0) return

  for (const task of staleTasks) {
    try {
      const correlationId = randomUUID()

      await db.update(workflowTasks)
        .set({ status: 'escalated', escalatedAt: now, escalationReason: 'Stale: no activity past due date', updatedAt: now })
        .where(
          sql`id = ${task.id}::uuid AND status NOT IN ('completed', 'cancelled')`
        )

      await db.insert(queueEscalations).values({
        organizationId: task.organizationId,
        targetEntityType: 'WorkflowTask',
        targetEntityId: task.id,
        trigger: 'sla_breach',
        previousLevel: 0,
        newLevel: 1,
        escalationReason: `Stale task: no activity for ${staleThresholdHours}h past due date`,
        breachedAt: task.updatedAt,
        actorType: 'system',
        actorId: 'sla-monitor.stale-task-sweep',
        escalatedAt: now,
        correlationId,
      })
    } catch (err) {
      console.error(`[stale-task-sweep] Failed for task ${task.id}:`, err)
    }
  }
}
