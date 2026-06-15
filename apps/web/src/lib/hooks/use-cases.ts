/**
 * Execution case list — GET /api/v1/cases
 */

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CaseClientSummary = {
  id: string
  fullName: string
  displayName: string | null
}

export type ExecutionCaseListItem = {
  id: string
  internalRef: string
  executionProcessNumber: string | null
  status: string
  courtName: string | null
  courtJurisdiction: string | null
  updatedAt: string
  clientSummary: CaseClientSummary
}

type CasesListResponse = {
  data: ExecutionCaseListItem[]
  nextCursor: string | null
}

export type CasesListFilters = {
  status?: string
  courtJurisdiction?: string
  q?: string
}

type UseCasesOptions = {
  organizationId: string
  filters?: CasesListFilters
  limit?: number
  enabled?: boolean
}

export function useCases({
  organizationId,
  filters,
  limit = 50,
  enabled = true,
}: UseCasesOptions) {
  return useInfiniteQuery<
    CasesListResponse,
    ApiError,
    InfiniteData<CasesListResponse>,
    ReturnType<typeof queryKeys.cases>,
    string | undefined
  >({
    queryKey: queryKeys.cases(organizationId, filters),
    queryFn: ({ pageParam, signal }) =>
      apiGet<CasesListResponse>('/api/v1/cases', {
        organizationId,
        signal,
        params: {
          limit,
          cursor: pageParam,
          status: filters?.status,
          courtJurisdiction: filters?.courtJurisdiction,
          q: filters?.q,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}
