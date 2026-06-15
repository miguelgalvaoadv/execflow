/**
 * WorkflowTask service — domain logic for task lifecycle operations.
 *
 * OPERATIONS:
 * - claimTask       — user claims an unclaimed task from the pool
 * - releaseTask     — user returns a claimed task to the pool
 * - completeTask    — user marks a task as completed with evidence
 *
 * VALIDATION REQUIREMENTS:
 * - Forbidden double assignment: claim rejected if already claimed
 * - Stale ownership protection: release rejected if user is not current claimant
 * - Terminal-task protection: complete rejected if already terminal
 * - Organization isolation: all operations scoped to organization
 *
 * AUDIT INTEGRATION:
 * Each operation writes an AuditLog entry in the same transaction via
 * writeAuditAndEvent(). This maintains the transactional audit guarantee.
 *
 * Architecture ref: office-operating-system.md §3 (ownership and assignment).
 */

import {
  findWorkflowTaskById,
  claimWorkflowTask,
  releaseWorkflowTask,
  completeWorkflowTask,
} from '../repositories/workflow-task.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import {
  ok,
  notFoundError,
  conflictError,
  forbiddenError,
  internalServiceError,
} from './result.ts'
import type { ServiceResult } from './result.ts'
import type { WorkflowTask } from '@execflow/db/schema'
import type { WriteContext } from '../lib/write-context.ts'

export type { WriteContext }

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

/**
 * Claim a workflow task.
 *
 * VALIDATION:
 * - Task must exist in the organization
 * - Task must be in 'pending' or 'released' state (not claimed, completed, cancelled)
 * - Task must not be already claimed by another user (atomic conditional update)
 *
 * DOUBLE-CLAIM PROTECTION:
 * The repository uses a conditional UPDATE (WHERE claimed_by_user_id IS NULL)
 * to atomically prevent two concurrent claims from succeeding.
 */
export async function claimTask(
  ctx: WriteContext,
  taskId: string
): Promise<ServiceResult<WorkflowTask>> {
  return ctx.db.transaction(async (tx: any) => {
    const taskResult = await findWorkflowTaskById(tx, ctx.organizationId, taskId)
    if (!taskResult.success) return notFoundError('Workflow task not found.')

    const task = taskResult.data

    if (task.status === 'completed' || task.status === 'cancelled') {
      return conflictError(
        `Cannot claim task in terminal state '${task.status}'.`
      )
    }

    if (task.status === 'claimed' || task.status === 'in_progress') {
      return conflictError(
        'Task is already claimed. Release it first or wait for the current claimant to release.'
      )
    }

    const claimResult = await claimWorkflowTask(tx, ctx.organizationId, taskId, ctx.userId)
    if (!claimResult.success) {
      if (claimResult.error.code === 'CONFLICT') {
        return conflictError(claimResult.error.message)
      }
      return internalServiceError('Failed to claim task.', claimResult.error)
    }

    await writeAuditAndEvent({
      tx,
      actor: ctx.actor,
      organizationId: ctx.organizationId,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
      action: 'workflow_task.claimed',
      entityType: 'WorkflowTask',
      entityId: taskId,
      aggregateType: 'WorkflowTask',
      aggregateId: taskId,
      eventType: 'workflow_task.claimed',
      occurredAt: new Date(),
      eventPayload: { taskId, previousStatus: task.status, newStatus: 'claimed', claimedByUserId: ctx.userId },
      changes: {
        type: 'state_transition',
        previous: task.status,
        next: 'claimed',
      },
    })

    return ok(claimResult.data)
  })
}

/**
 * Release a workflow task back to the pool.
 *
 * VALIDATION:
 * - Task must exist in the organization
 * - Task must not be in a terminal state
 * - Only the CURRENT CLAIMANT can release (stale ownership protection)
 *
 * STALE OWNERSHIP PROTECTION:
 * If the current actor is not the claimant, the release is rejected.
 * Supervisors must reassign, not release.
 */
export async function releaseTask(
  ctx: WriteContext,
  taskId: string
): Promise<ServiceResult<WorkflowTask>> {
  return ctx.db.transaction(async (tx: any) => {
    const taskResult = await findWorkflowTaskById(tx, ctx.organizationId, taskId)
    if (!taskResult.success) return notFoundError('Workflow task not found.')

    const task = taskResult.data

    if (task.status === 'completed' || task.status === 'cancelled') {
      return conflictError(`Cannot release task in terminal state '${task.status}'.`)
    }

    if (task.status === 'pending' || task.status === 'released') {
      return conflictError('Task is not currently claimed.')
    }

    if (task.claimedByUserId !== ctx.userId) {
      return forbiddenError(
        'Only the current claimant can release this task. ' +
        'Contact a manager to reassign.'
      )
    }

    const releaseResult = await releaseWorkflowTask(
      tx,
      ctx.organizationId,
      taskId,
      ctx.userId
    )
    if (!releaseResult.success) {
      if (releaseResult.error.code === 'FORBIDDEN') {
        return forbiddenError(releaseResult.error.message)
      }
      return internalServiceError('Failed to release task.', releaseResult.error)
    }

    await writeAuditAndEvent({
      tx,
      actor: ctx.actor,
      organizationId: ctx.organizationId,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
      action: 'workflow_task.released',
      entityType: 'WorkflowTask',
      entityId: taskId,
      aggregateType: 'WorkflowTask',
      aggregateId: taskId,
      eventType: 'workflow_task.released',
      occurredAt: new Date(),
      eventPayload: { taskId, previousStatus: task.status, newStatus: 'released', releasedByUserId: ctx.userId },
      changes: {
        type: 'state_transition',
        previous: task.status,
        next: 'released',
      },
    })

    return ok(releaseResult.data)
  })
}

/**
 * Complete a workflow task.
 *
 * VALIDATION:
 * - Task must exist in the organization
 * - Task must NOT be in a terminal state (completed, cancelled)
 *
 * COMPLETION ACTOR:
 * Any user in the organization can complete a task (not just the claimant).
 * This allows supervisors to mark tasks done. completedByUserId is always
 * the actual actor.
 */
export async function completeTask(
  ctx: WriteContext,
  taskId: string,
  params?: {
    evidenceType?: string
    evidenceId?: string
  }
): Promise<ServiceResult<WorkflowTask>> {
  return ctx.db.transaction(async (tx: any) => {
    const taskResult = await findWorkflowTaskById(tx, ctx.organizationId, taskId)
    if (!taskResult.success) return notFoundError('Workflow task not found.')

    const task = taskResult.data

    if (task.status === 'completed') {
      return conflictError('Task is already completed.')
    }

    if (task.status === 'cancelled') {
      return conflictError('Cannot complete a cancelled task.')
    }

    const completeResult = await completeWorkflowTask(
      tx,
      ctx.organizationId,
      taskId,
      ctx.userId,
      params?.evidenceType,
      params?.evidenceId
    )
    if (!completeResult.success) {
      return internalServiceError('Failed to complete task.', completeResult.error)
    }

    await writeAuditAndEvent({
      tx,
      actor: ctx.actor,
      organizationId: ctx.organizationId,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
      action: 'workflow_task.completed',
      entityType: 'WorkflowTask',
      entityId: taskId,
      aggregateType: 'WorkflowTask',
      aggregateId: taskId,
      eventType: 'workflow_task.completed',
      occurredAt: new Date(),
      eventPayload: {
        taskId,
        previousStatus: task.status,
        newStatus: 'completed',
        completedByUserId: ctx.userId,
        ...(params?.evidenceType ? { evidenceType: params.evidenceType } : {}),
        ...(params?.evidenceId ? { evidenceId: params.evidenceId } : {}),
      },
      changes: {
        type: 'state_transition',
        previous: task.status,
        next: 'completed',
        ...(params?.evidenceType ? { reason: `Evidence: ${params.evidenceType}` } : {}),
      },
    })

    return ok(completeResult.data)
  })
}
