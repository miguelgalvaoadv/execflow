/**
 * Client detail — GET /api/v1/clients/:id
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type ClientContactChannel = {
  type: string
  value: string
  notes?: string
}

export type ClientDetail = {
  id: string
  organizationId: string
  fullName: string
  displayName: string | null
  aliases: string[]
  internalRef: string | null
  responsibleLawyerUserId: string | null
  notes: string | null
  status: string
  createdAt: string
  updatedAt: string
  cpf?: string | null
  rg?: string | null
  birthDate?: string | null
  contactChannels?: ClientContactChannel[]
}

type ClientDetailResponse = {
  data: ClientDetail
}

export function useClient(organizationId: string, clientId: string, enabled = true) {
  return useQuery<ClientDetailResponse, ApiError>({
    queryKey: queryKeys.client(organizationId, clientId),
    queryFn: ({ signal }) =>
      apiGet<ClientDetailResponse>(`/api/v1/clients/${clientId}`, {
        organizationId,
        signal,
      }),
    staleTime: 60 * 1000,
    enabled: organizationId !== '' && clientId !== '' && enabled,
  })
}
