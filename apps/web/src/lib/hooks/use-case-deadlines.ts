/**
 * Case deadlines list — GET /api/v1/cases/:caseId/deadlines
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CaseDeadlineItem = {
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
  completedAt: string | null
  dismissedAt: string | null
  isBlocked: boolean
  isStale: boolean
  createdAt: string
  updatedAt: string
}

type CaseDeadlinesResponse = {
  data: CaseDeadlineItem[]
  nextCursor: string | null
}

export function useCaseDeadlines(
  organizationId: string,
  caseId: string,
  enabled = true
) {
  return useQuery<CaseDeadlinesResponse, ApiError>({
    queryKey: queryKeys.caseDeadlines(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseDeadlinesResponse>(`/api/v1/cases/${caseId}/deadlines`, {
        organizationId,
        signal,
        params: { limit: 50 },
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}
