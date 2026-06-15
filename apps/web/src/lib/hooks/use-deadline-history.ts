/**
 * Deadline history — GET /api/v1/deadlines/:id/history
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type DeadlineHistoryItem = {
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

type DeadlineHistoryResponse = {
  data: DeadlineHistoryItem[]
}

export function useDeadlineHistory(
  organizationId: string,
  deadlineId: string,
  enabled = true
) {
  return useQuery<DeadlineHistoryResponse, ApiError>({
    queryKey: queryKeys.deadlineHistory(organizationId, deadlineId),
    queryFn: ({ signal }) =>
      apiGet<DeadlineHistoryResponse>(`/api/v1/deadlines/${deadlineId}/history`, {
        organizationId,
        signal,
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && deadlineId !== '' && enabled,
  })
}
