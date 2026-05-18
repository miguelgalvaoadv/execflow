/**
 * WorkflowTask creation functions called by event consumers.
 *
 * These functions create WorkflowTask records from domain events.
 * They are called inside event consumer handlers and may run in transactions.
 *
 * DESIGN PRINCIPLE (from office-operating-system.md §6.1):
 * "Every critical legal deadline spawns a linked assistant task."
 * This module implements that rule for Phase 6 — creating tasks when
 * high-priority deadlines, intake bundles, and key opportunities are created.
 *
 * IDEMPOTENCY:
 * Tasks are created with a `causingEventId` reference. Before creating a task,
 * consumers check if a task with the same `causingEventId` already exists.
 * This prevents duplicate tasks on event re-processing.
 *
 * Architecture ref: office-operating-system.md §3, §6.1.
 */

import { eq } from '@execflow/db/client'
import type { WorkersDb, WorkersTx } from '../lib/db.ts'

type DbOrTx = WorkersDb | WorkersTx

/**
 * Checks if a WorkflowTask already exists for a given causing event.
 * Used for idempotency guard before creating tasks.
 */
async function taskExistsForEvent(
  db: DbOrTx,
  causingEventId: string
): Promise<boolean> {
  const { workflowTasks } = await import('@execflow/db/schema')

  const rows = await db
    .select({ id: workflowTasks.id })
    .from(workflowTasks)
    .where(eq(workflowTasks.causingEventId, causingEventId))
    .limit(1)

  return rows.length > 0
}

/**
 * Creates a WorkflowTask for a high-priority deadline.
 * Per office-operating-system.md §6.1: critical deadlines spawn linked tasks.
 *
 * Only creates tasks for legal/critical deadlines to avoid task noise.
 * IDEMPOTENT: checks causingEventId before insert.
 */
export async function maybeCreateDeadlineActionTask(
  db: DbOrTx,
  params: {
    organizationId: string
    executionCaseId: string | undefined
    deadlineId: string
    deadlineTitle: string
    deadlineClass: string
    deadlinePriority: string
    dueAt: Date
    causingEventId: string
    correlationId: string
    createdBySystemActorId: string
  }
): Promise<void> {
  const { workflowTasks } = await import('@execflow/db/schema')

  const shouldCreateTask =
    params.deadlinePriority === 'critical' || params.deadlinePriority === 'high'

  if (!shouldCreateTask) return
  if (await taskExistsForEvent(db, params.causingEventId)) return

  const slaFromDueAt = new Date(params.dueAt.getTime() - 24 * 60 * 60 * 1000)

  await db.insert(workflowTasks).values({
    organizationId: params.organizationId,
    ...(params.executionCaseId !== undefined ? { executionCaseId: params.executionCaseId } : {}),
    taskType: 'deadline_action',
    title: `Ação necessária: ${params.deadlineTitle}`,
    status: 'pending',
    priority: params.deadlinePriority as 'critical' | 'high' | 'normal' | 'low',
    sourceEntityType: 'Deadline',
    sourceEntityId: params.deadlineId,
    causingEventId: params.causingEventId,
    linkedDeadlineId: params.deadlineId,
    requiresReview: params.deadlineClass === 'legal',
    dueAt: slaFromDueAt,
    taskMetadata: { deadlineClass: params.deadlineClass },
  })
}

/**
 * Creates a WorkflowTask for reviewing a new intake bundle.
 * IDEMPOTENT: checks causingEventId before insert.
 */
export async function createIntakeTriageTask(
  db: DbOrTx,
  params: {
    organizationId: string
    intakeBundleId: string
    intakeBundleRef: string
    causingEventId: string
  }
): Promise<void> {
  const { workflowTasks } = await import('@execflow/db/schema')

  if (await taskExistsForEvent(db, params.causingEventId)) return

  const slaDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await db.insert(workflowTasks).values({
    organizationId: params.organizationId,
    taskType: 'intake_triage',
    title: `Triagem de entrada: ${params.intakeBundleRef}`,
    status: 'pending',
    priority: 'normal',
    sourceEntityType: 'IntakeBundle',
    sourceEntityId: params.intakeBundleId,
    causingEventId: params.causingEventId,
    requiresReview: false,
    dueAt: slaDeadline,
    taskMetadata: { intakeBundleRef: params.intakeBundleRef },
  })
}

/**
 * Creates a WorkflowTask for reviewing an opportunity (triage before lawyer sees).
 * Created for non-critical opportunities where assistant triage is needed.
 * IDEMPOTENT: checks causingEventId before insert.
 */
export async function createOpportunityReviewTask(
  db: DbOrTx,
  params: {
    organizationId: string
    executionCaseId: string | undefined
    opportunityId: string
    opportunityType: string
    opportunitySummary: string | null
    causingEventId: string
  }
): Promise<void> {
  const { workflowTasks } = await import('@execflow/db/schema')

  if (await taskExistsForEvent(db, params.causingEventId)) return

  const slaDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)

  await db.insert(workflowTasks).values({
    organizationId: params.organizationId,
    ...(params.executionCaseId !== undefined ? { executionCaseId: params.executionCaseId } : {}),
    taskType: 'review_opportunity',
    title: `Revisar oportunidade: ${params.opportunityType}`,
    description: params.opportunitySummary ?? undefined,
    status: 'pending',
    priority: 'normal',
    sourceEntityType: 'Opportunity',
    sourceEntityId: params.opportunityId,
    causingEventId: params.causingEventId,
    requiresReview: true,
    dueAt: slaDeadline,
    taskMetadata: { opportunityType: params.opportunityType },
  })
}
