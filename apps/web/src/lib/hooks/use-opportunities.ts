/**
 * Org opportunity list — GET /api/v1/opportunities
 */

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type OpportunityListItem = {
  id: string
  opportunityType: string
  status: string
  summary: string
  confidenceLevel: string | null
  detectedAt: string
  windowEndAt: string | null
  executionCaseId: string
  caseInternalRef: string | null
  clientName: string | null
  processNumber: string | null
}

type OpportunitiesListResponse = {
  data: OpportunityListItem[]
  nextCursor: string | null
}

export type OpportunitiesListFilters = {
  status?: string
  opportunityType?: string
  q?: string
}

type UseOpportunitiesOptions = {
  organizationId: string
  filters?: OpportunitiesListFilters
  limit?: number
  enabled?: boolean
}

export function useOpportunities({
  organizationId,
  filters,
  limit = 50,
  enabled = true,
}: UseOpportunitiesOptions) {
  return useInfiniteQuery<
    OpportunitiesListResponse,
    ApiError,
    InfiniteData<OpportunitiesListResponse>,
    ReturnType<typeof queryKeys.opportunitiesList>,
    string | undefined
  >({
    queryKey: queryKeys.opportunitiesList(organizationId, filters),
    queryFn: ({ pageParam, signal }) =>
      apiGet<OpportunitiesListResponse>('/api/v1/opportunities', {
        organizationId,
        signal,
        params: {
          limit,
          cursor: pageParam,
          status: filters?.status,
          opportunityType: filters?.opportunityType,
          q: filters?.q,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}
