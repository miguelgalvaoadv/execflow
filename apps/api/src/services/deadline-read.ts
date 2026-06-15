/**
 * Deadline read service — org list, detail, and history for Deadline Central.
 */

import {
  findDeadlineById,
  listDeadlinesForOrg as listDeadlinesForOrgRepo,
  type DeadlineOrgListItem,
  type ListDeadlinesForOrgFilters,
} from '../repositories/deadline.ts'
import { queryDeadlineHistory } from '../repositories/deadline-history.ts'
import { findCaseById } from '../repositories/execution-case.ts'
import {
  ok,
  validationError,
  notFoundError,
  fromRepositoryError,
} from './result.ts'
import { canViewCases, resolveMembershipRole } from '../lib/permissions.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from './result.ts'
import type { DeadlineHistoryRecord } from '@execflow/db/schema'

export type DeadlineOrgListItemResponse = {
  id: string
  title: string
  deadlineClass: string
  status: string
  priority: string
  dueAt: string
  executionCaseId: string
  caseInternalRef: string | null
}

export type PaginatedDeadlinesResponse = {
  items: DeadlineOrgListItemResponse[]
  nextCursor: string | null
}

export type DeadlineCaseSummary = {
  id: string
  internalRef: string
}

export type DeadlineDetailView = {
  id: string
  organizationId: string
  executionCaseId: string
  title: string
  description: string | null
  dueAt: string
  deadlineClass: string
  origin: string
  priority: string
  status: string
  assigneeUserId: string | null
  acknowledgedAt: string | null
  acknowledgedByUserId: string | null
  completedAt: string | null
  completedByUserId: string | null
  dismissedAt: string | null
  dismissedByUserId: string | null
  dismissedReason: string | null
  dismissedReasonCode: string | null
  escalationLevel: number
  escalatedAt: string | null
  isBlocked: boolean
  blockingReason: string | null
  isStale: boolean
  createdAt: string
  updatedAt: string
  caseSummary: DeadlineCaseSummary
}

export type DeadlineHistoryItemResponse = {
  id: string
  changeType: string
  previousValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  reason: string | null
  changedByActorType: string
  changedByActorId: string
  changedByUserId: string | null
  changedAt: string
}

function toOrgListItemResponse(item: DeadlineOrgListItem): DeadlineOrgListItemResponse {
  return {
    id: item.id,
    title: item.title,
    deadlineClass: item.deadlineClass,
    status: item.status,
    priority: item.priority,
    dueAt: item.dueAt.toISOString(),
    executionCaseId: item.executionCaseId,
    caseInternalRef: item.caseInternalRef,
  }
}

function toHistoryItemResponse(row: DeadlineHistoryRecord): DeadlineHistoryItemResponse {
  return {
    id: row.id,
    changeType: row.changeType,
    previousValue: (row.previousValue as Record<string, unknown> | null) ?? null,
    newValue: (row.newValue as Record<string, unknown> | null) ?? null,
    reason: row.reason,
    changedByActorType: row.changedByActorType,
    changedByActorId: row.changedByActorId,
    changedByUserId: row.changedByUserId,
    changedAt: row.changedAt.toISOString(),
  }
}

export async function listDeadlinesForOrg(
  ctx: ReadContext,
  filters: ListDeadlinesForOrgFilters,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedDeadlinesResponse>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view deadlines.')
  }

  const result = await listDeadlinesForOrgRepo(ctx.db, ctx.organizationId, filters, {
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
  })

  if (!result.success) {
    if (result.error.code === 'CONSTRAINT') {
      return validationError(result.error.message)
    }
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok({
    items: result.data.items.map(toOrgListItemResponse),
    nextCursor: result.data.nextCursor,
  })
}

export async function getDeadlineDetail(
  ctx: ReadContext,
  deadlineId: string
): Promise<ServiceResult<DeadlineDetailView>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view deadlines.')
  }

  const deadlineResult = await findDeadlineById(ctx.db, ctx.organizationId, deadlineId)
  if (!deadlineResult.success) {
    if (deadlineResult.error.code === 'NOT_FOUND') {
      return notFoundError('Deadline not found.')
    }
    return fromRepositoryError(
      deadlineResult.error.code,
      deadlineResult.error.message,
      deadlineResult.error.cause
    )
  }

  const deadline = deadlineResult.data

  const caseResult = await findCaseById(ctx.db, ctx.organizationId, deadline.executionCaseId)
  if (!caseResult.success) {
    return notFoundError('Execution case not found.')
  }

  return ok({
    id: deadline.id,
    organizationId: deadline.organizationId,
    executionCaseId: deadline.executionCaseId,
    title: deadline.title,
    description: deadline.description,
    dueAt: deadline.dueAt.toISOString(),
    deadlineClass: deadline.deadlineClass,
    origin: deadline.origin,
    priority: deadline.priority,
    status: deadline.status,
    assigneeUserId: deadline.assigneeUserId,
    acknowledgedAt: deadline.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByUserId: deadline.acknowledgedByUserId,
    completedAt: deadline.completedAt?.toISOString() ?? null,
    completedByUserId: deadline.completedByUserId,
    dismissedAt: deadline.dismissedAt?.toISOString() ?? null,
    dismissedByUserId: deadline.dismissedByUserId,
    dismissedReason: deadline.dismissedReason,
    dismissedReasonCode: deadline.dismissedReasonCode,
    escalationLevel: deadline.escalationLevel,
    escalatedAt: deadline.escalatedAt?.toISOString() ?? null,
    isBlocked: deadline.isBlocked,
    blockingReason: deadline.blockingReason,
    isStale: deadline.isStale,
    createdAt: deadline.createdAt.toISOString(),
    updatedAt: deadline.updatedAt.toISOString(),
    caseSummary: {
      id: caseResult.data.id,
      internalRef: caseResult.data.internalRef,
    },
  })
}

export async function listDeadlineHistory(
  ctx: ReadContext,
  deadlineId: string
): Promise<ServiceResult<DeadlineHistoryItemResponse[]>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view deadline history.')
  }

  const deadlineResult = await findDeadlineById(ctx.db, ctx.organizationId, deadlineId)
  if (!deadlineResult.success) {
    if (deadlineResult.error.code === 'NOT_FOUND') {
      return notFoundError('Deadline not found.')
    }
    return fromRepositoryError(
      deadlineResult.error.code,
      deadlineResult.error.message,
      deadlineResult.error.cause
    )
  }

  const result = await queryDeadlineHistory(ctx.db, ctx.organizationId, deadlineId)
  if (!result.success) {
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok(result.data.map(toHistoryItemResponse))
}
