/**
 * Case timeline — GET /api/v1/cases/:caseId/timeline
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type TimelineEventItem = {
  id: string
  organizationId: string
  executionCaseId: string
  eventType: string
  eventCategory: string
  occurredAt: string
  recordedAt: string
  summary: string
  payload: Record<string, unknown>
  source: string
  visibility: string
  authorUserId: string | null
  actorType: string
  actorId: string
}

type CaseTimelineResponse = {
  data: TimelineEventItem[]
  nextCursor: string | null
}

export function useCaseTimeline(
  organizationId: string,
  caseId: string,
  enabled = true
) {
  return useQuery<CaseTimelineResponse, ApiError>({
    queryKey: queryKeys.caseTimeline(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseTimelineResponse>(`/api/v1/cases/${caseId}/timeline`, {
        organizationId,
        signal,
        params: { limit: 50 },
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}
