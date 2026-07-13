import { useQuery, useMutation, useQueryClient, type QueryObserverResult } from '@tanstack/react-query'
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

/**
 * refetchInterval compartilhado pelos hooks de status assíncrono (sync do
 * tribunal, análise de autos): enquanto o status for pending/running,
 * atualiza a cada 2s pra dar efeito tempo real; parado nos demais casos.
 */
function pollWhilePendingOrRunning<T extends { status: string } | null | undefined>(
  query: QueryObserverResult<{ data: T }, ApiError> | { state: { data?: { data: T } | undefined } }
): number | false {
  const status = (query as { state: { data?: { data: T } | undefined } }).state.data?.data?.status
  return status === 'pending' || status === 'running' ? 2000 : false
}

export function useCrawlerSyncStatus(organizationId: string, caseId: string, enabled = true) {
  return useQuery<{ data: CrawlerSyncLogItem | null }, ApiError>({
    queryKey: ['crawler-sync-status', organizationId, caseId],
    queryFn: ({ signal }) =>
      apiGet<{ data: CrawlerSyncLogItem | null }>(`/api/v1/cases/${caseId}/sync-status`, {
        organizationId,
        signal,
      }),
    refetchInterval: pollWhilePendingOrRunning<CrawlerSyncLogItem | null>,
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

export type CasePanelAlert = {
  titulo: string
  descricao: string
  oQueConferir: string
  gatilho: string
}

export type CasePanelFact = {
  titulo: string
  descricao: string
  impactoNoCalculo: string
}

export type CaseAnalysisResult = {
  snapshotId?: string
  resumoPena: string | null
  oportunidadesCriadas: number
  prazosCriados: number
  incremental: boolean
  documentosLidos: number
  // Taxonomia: alertas (possibilidades a conferir) e fatos (já consumados) não
  // são "oportunidades" — vêm no resultado da análise e a tela mostra como
  // cards informativos. Opcionais: análises antigas (antes de 12/07/2026) não
  // tinham esses campos.
  alertas?: CasePanelAlert[]
  fatos?: CasePanelFact[]
}

export type CaseAnalysisRunItem = {
  id: string
  organizationId: string
  executionCaseId: string
  status: 'pending' | 'running' | 'success' | 'failed'
  startedAt: string | null
  completedAt: string | null
  result: CaseAnalysisResult | null
  errorDetails: string | null
  createdAt: string
}

/**
 * Status da última análise de autos (IA) — polling enquanto pending/running.
 * A chamada ao Claude leva 60-120s+; a rota /analyze responde 202 na hora e
 * roda em segundo plano (achado 08/07/2026: segurar a requisição HTTP até o
 * fim atravessa o proxy do Next.js e devolve 500 mesmo com sucesso no backend).
 */
export function useAnalysisStatus(organizationId: string, caseId: string, enabled = true) {
  return useQuery<{ data: CaseAnalysisRunItem | null }, ApiError>({
    queryKey: ['case-analysis-status', organizationId, caseId],
    queryFn: ({ signal }) =>
      apiGet<{ data: CaseAnalysisRunItem | null }>(`/api/v1/cases/${caseId}/analysis-status`, {
        organizationId,
        signal,
      }),
    refetchInterval: pollWhilePendingOrRunning<CaseAnalysisRunItem | null>,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}

/**
 * Dispara a análise dos autos por IA (Claude): gera cálculo de pena, oportunidades
 * e prazos a partir dos autos confirmados. Assíncrono — devolve 202 na hora;
 * acompanhe o progresso com useAnalysisStatus.
 */
export function useAnalyzeAutos(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: CaseAnalysisRunItem }, ApiError, void>({
    mutationFn: () =>
      apiPost<{ data: CaseAnalysisRunItem }>(
        `/api/v1/cases/${caseId}/analyze`,
        {},
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['case-analysis-status', organizationId, caseId] })
    },
  })
}

/** Invalida as queries que a análise concluída afeta (cálculo, oportunidades, prazos). */
export function invalidateAnalysisResults(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  caseId: string
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.caseSentenceSnapshots(organizationId, caseId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.caseDeadlines(organizationId, caseId) })
}

/**
 * Invalida as queries que uma sincronização de tribunal concluída afeta.
 * Achado 08/07/2026 (relatado pelo Miguel, comparando o painel com o e-SAJ
 * real): "Sincronizar Tribunal" atualizava o banco corretamente (confirmado
 * — movimentações de julho/2026 já estavam lá), mas a aba Movimentações
 * (e Oportunidades/Prazos/dados do caso) nunca era avisada de que havia
 * dado novo — o React Query continuava servindo o cache antigo até um
 * reload manual da página inteira. Mesma classe de bug de UI travada em
 * estado velho já corrigida em "Analisar autos".
 */
export function invalidateCrawlerSyncResults(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  caseId: string
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.caseTimeline(organizationId, caseId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.caseDeadlines(organizationId, caseId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.case(organizationId, caseId) })
}
