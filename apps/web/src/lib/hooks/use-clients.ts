/**
 * Client list — GET /api/v1/clients
 */

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type ClientListItem = {
  id: string
  fullName: string
  displayName: string | null
  internalRef: string | null
  status: string
  responsibleLawyerUserId: string | null
  updatedAt: string
}

type ClientsListResponse = {
  data: ClientListItem[]
  nextCursor: string | null
}

export type ClientsListFilters = {
  status?: string
  q?: string
}

type UseClientsOptions = {
  organizationId: string
  filters?: ClientsListFilters
  limit?: number
  enabled?: boolean
}

export function useClients({
  organizationId,
  filters,
  limit = 50,
  enabled = true,
}: UseClientsOptions) {
  return useInfiniteQuery<
    ClientsListResponse,
    ApiError,
    InfiniteData<ClientsListResponse>,
    ReturnType<typeof queryKeys.clients>,
    string | undefined
  >({
    queryKey: queryKeys.clients(organizationId, filters),
    queryFn: ({ pageParam, signal }) =>
      apiGet<ClientsListResponse>('/api/v1/clients', {
        organizationId,
        signal,
        params: {
          limit,
          cursor: pageParam,
          status: filters?.status,
          q: filters?.q,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}
