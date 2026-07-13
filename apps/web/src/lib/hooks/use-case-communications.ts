/**
 * Intimações de UM caso — GET /api/v1/communications?executionCaseId=...
 *
 * Mesma tabela/endpoint da tela geral (/intimations), só filtrada pelo caso.
 * Pedido do Miguel 13/07/2026: ver as intimações do processo direto na aba
 * dele, não só no "geralzão".
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CaseCommunicationItem = {
  id: string
  processNumber: string | null
  kind: string
  source: string
  content: string | null
  availableAt: string | null
  publishedAt: string | null
  possibleDeadline: boolean
  status: 'new' | 'processed' | 'dismissed'
  createdAt: string
}

type CaseCommunicationsResponse = {
  data: CaseCommunicationItem[]
  counters: { total: number; unprocessed: number; withDeadline: number } | null
}

export function useCaseCommunications(
  organizationId: string,
  caseId: string,
  enabled = true
) {
  return useQuery<CaseCommunicationsResponse, ApiError>({
    queryKey: queryKeys.caseCommunications(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseCommunicationsResponse>('/api/v1/communications', {
        organizationId,
        signal,
        params: { executionCaseId: caseId, limit: 100 },
      }),
    staleTime: 30 * 1000,
    refetchInterval: 90 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}

export function useResolveCaseCommunication(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    unknown,
    ApiError,
    { id: string; body: { action: 'mark_seen' | 'mark_unseen' | 'dismiss' } }
  >({
    mutationFn: ({ id, body }) =>
      apiPost(`/api/v1/communications/${id}/resolve`, body, { organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseCommunications(organizationId, caseId) })
      // A tela geral (/intimations) usa a mesma tabela — invalida também.
      void queryClient.invalidateQueries({ queryKey: ['communications', organizationId] })
    },
  })
}
