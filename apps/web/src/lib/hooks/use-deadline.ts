/**
 * Deadline detail — GET /api/v1/deadlines/:id
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type DeadlineCaseSummary = {
  id: string
  internalRef: string
}

export type DeadlineDetail = {
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
  legalBasis: string | null
  sourceDocumentId: string | null
  completionEvidenceType: string | null
  completionEvidenceId: string | null
}

type DeadlineDetailResponse = {
  data: DeadlineDetail
}

export function useDeadline(organizationId: string, deadlineId: string, enabled = true) {
  return useQuery<DeadlineDetailResponse, ApiError>({
    queryKey: queryKeys.deadline(organizationId, deadlineId),
    queryFn: ({ signal }) =>
      apiGet<DeadlineDetailResponse>(`/api/v1/deadlines/${deadlineId}`, {
        organizationId,
        signal,
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && deadlineId !== '' && enabled,
  })
}
