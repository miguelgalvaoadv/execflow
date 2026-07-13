/**
 * Org deadline list — GET /api/v1/deadlines
 */

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type DeadlineListItem = {
  id: string
  title: string
  deadlineClass: string
  status: string
  priority: string
  dueAt: string
  executionCaseId: string
  caseInternalRef: string | null
  clientName: string | null
  processNumber: string | null
}

type DeadlinesListResponse = {
  data: DeadlineListItem[]
  nextCursor: string | null
}

export type DeadlinesListFilters = {
  status?: string
  deadlineClass?: string
  priority?: string
  q?: string
}

type UseDeadlinesOptions = {
  organizationId: string
  filters?: DeadlinesListFilters
  limit?: number
  enabled?: boolean
}

export function useDeadlines({
  organizationId,
  filters,
  limit = 50,
  enabled = true,
}: UseDeadlinesOptions) {
  return useInfiniteQuery<
    DeadlinesListResponse,
    ApiError,
    InfiniteData<DeadlinesListResponse>,
    ReturnType<typeof queryKeys.deadlines>,
    string | undefined
  >({
    queryKey: queryKeys.deadlines(organizationId, filters),
    queryFn: ({ pageParam, signal }) =>
      apiGet<DeadlinesListResponse>('/api/v1/deadlines', {
        organizationId,
        signal,
        params: {
          limit,
          cursor: pageParam,
          status: filters?.status,
          deadlineClass: filters?.deadlineClass,
          priority: filters?.priority,
          q: filters?.q,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}
