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
    // Repolla enquanto a tela do caso estiver aberta — sem isso, uma
    // movimentação trazida pelo cron automático do InfoSimples/DJEN (sem
    // nenhum clique do advogado) só aparecia depois de um reload manual da
    // página. Achado 08/07/2026 (Higor Gabriel): o banco já tinha a
    // movimentação nova, a tela é que nunca ia buscar de novo sozinha.
    refetchInterval: 90 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}
