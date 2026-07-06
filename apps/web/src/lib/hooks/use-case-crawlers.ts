import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CrawlerSyncLogItem = {
  id: string
  organizationId: string
  executionCaseId: string
  status: 'pending' | 'running' | 'success' | 'failed'
  tribunalName: string | null
  startedAt: string | null
  completedAt: string | null
  errorDetails: string | null
  createdAt: string
}

export function useCrawlerSyncStatus(organizationId: string, caseId: string, enabled = true) {
  return useQuery<{ data: CrawlerSyncLogItem | null }, ApiError>({
    queryKey: ['crawler-sync-status', organizationId, caseId],
    queryFn: ({ signal }) =>
      apiGet<{ data: CrawlerSyncLogItem | null }>(`/api/v1/cases/${caseId}/sync-status`, {
        organizationId,
        signal,
      }),
    refetchInterval: (query) => {
      // Se tiver rodando ou pending, atualiza a cada 2 segundos pra dar efeito tempo real
      const status = query.state.data?.data?.status
      if (status === 'pending' || status === 'running') {
        return 2000
      }
      return false
    },
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}

export function useTriggerCrawlerSync(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: CrawlerSyncLogItem }, ApiError, void>({
    mutationFn: () =>
      apiPost<{ data: CrawlerSyncLogItem }>(
        `/api/v1/cases/${caseId}/sync-tribunal`,
        {},
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crawler-sync-status', organizationId, caseId] })
      // Invalidar documentos em breve porque o crawler pode trazer novos
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseDocuments(organizationId, caseId) })
    },
  })
}

export type CaseAnalysisResult = {
  snapshotId?: string
  resumoPena: string | null
  oportunidadesCriadas: number
  prazosCriados: number
}

/**
 * Dispara a análise dos autos por IA (Claude): gera cálculo de pena, oportunidades
 * e prazos a partir dos autos confirmados. Síncrono (pode levar ~30s).
 */
export function useAnalyzeAutos(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: CaseAnalysisResult }, ApiError, void>({
    mutationFn: () =>
      apiPost<{ data: CaseAnalysisResult }>(
        `/api/v1/cases/${caseId}/analyze`,
        {},
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseSentenceSnapshots(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseDeadlines(organizationId, caseId) })
    },
  })
}
