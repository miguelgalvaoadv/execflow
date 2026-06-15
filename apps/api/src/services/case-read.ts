/**
 * Execution case read service — case profile and list for Case Workspace.
 */

import {
  findCaseDetailById,
  listExecutionCases,
  type ExecutionCaseDetail,
  type ExecutionCaseListItem,
  type ListExecutionCasesFilters,
} from '../repositories/execution-case.ts'
import {
  ok,
  validationError,
  notFoundError,
  fromRepositoryError,
} from './result.ts'
import { canViewCases, resolveMembershipRole } from '../lib/permissions.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from './result.ts'

export type ExecutionCaseListItemResponse = {
  id: string
  internalRef: string
  executionProcessNumber: string | null
  status: string
  courtName: string | null
  courtJurisdiction: string | null
  updatedAt: string
  clientSummary: ExecutionCaseListItem['clientSummary']
}

export type PaginatedCasesResponse = {
  items: ExecutionCaseListItemResponse[]
  nextCursor: string | null
}

function toListItemResponse(item: ExecutionCaseListItem): ExecutionCaseListItemResponse {
  return {
    id: item.id,
    internalRef: item.internalRef,
    executionProcessNumber: item.executionProcessNumber,
    status: item.status,
    courtName: item.courtName,
    courtJurisdiction: item.courtJurisdiction,
    updatedAt: item.updatedAt.toISOString(),
    clientSummary: item.clientSummary,
  }
}

export async function getExecutionCaseDetail(
  ctx: ReadContext,
  caseId: string
): Promise<ServiceResult<ExecutionCaseDetail>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view execution cases.')
  }

  const result = await findCaseDetailById(ctx.db, ctx.organizationId, caseId)
  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return notFoundError('Execution case not found.')
    }
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok(result.data)
}

export async function listExecutionCasesForOrg(
  ctx: ReadContext,
  filters: ListExecutionCasesFilters,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedCasesResponse>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view execution cases.')
  }

  const result = await listExecutionCases(ctx.db, ctx.organizationId, filters, {
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
    items: result.data.items.map(toListItemResponse),
    nextCursor: result.data.nextCursor,
  })
}
