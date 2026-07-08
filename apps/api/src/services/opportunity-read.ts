/**
 * Opportunity read service — org-wide list for the firm-wide triage view.
 */

import {
  listOpportunitiesForOrg as listOpportunitiesForOrgRepo,
  type OpportunityOrgListItem,
  type ListOpportunitiesForOrgFilters,
} from '../repositories/opportunity.ts'
import { ok, validationError, fromRepositoryError } from './result.ts'
import { canViewCases, resolveMembershipRole } from '../lib/permissions.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from './result.ts'

export type OpportunityOrgListItemResponse = {
  id: string
  opportunityType: string
  status: string
  summary: string
  confidenceLevel: string | null
  detectedAt: string
  windowEndAt: string | null
  executionCaseId: string
  caseInternalRef: string | null
}

export type PaginatedOpportunitiesResponse = {
  items: OpportunityOrgListItemResponse[]
  nextCursor: string | null
}

function toOrgListItemResponse(item: OpportunityOrgListItem): OpportunityOrgListItemResponse {
  return {
    id: item.id,
    opportunityType: item.opportunityType,
    status: item.status,
    summary: item.summary,
    confidenceLevel: item.confidenceLevel,
    detectedAt: item.detectedAt.toISOString(),
    windowEndAt: item.windowEndAt ? item.windowEndAt.toISOString() : null,
    executionCaseId: item.executionCaseId,
    caseInternalRef: item.caseInternalRef,
  }
}

export async function listOpportunitiesForOrg(
  ctx: ReadContext,
  filters: ListOpportunitiesForOrgFilters,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedOpportunitiesResponse>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view opportunities.')
  }

  const result = await listOpportunitiesForOrgRepo(ctx.db, ctx.organizationId, filters, {
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
