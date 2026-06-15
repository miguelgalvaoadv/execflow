import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type SentenceSnapshotItem = {
  id: string
  organizationId: string
  executionCaseId: string
  effectiveAt: string
  status: 'proposed' | 'confirmed' | 'superseded'
  totalSentenceDays: number
  servedDays: number
  remissionDays: number
  detractionDays: number
  remainingDays: number
  percentServed: number
  confidenceLevel: string
  calculationMethod: string | null
  playbookVersionId: string | null
  sourceDocumentIds: string[]
  explanation: Record<string, unknown> | null
  amendsSnapshotId: string | null
  confirmedByUserId: string | null
  confirmedAt: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

type CaseSentenceSnapshotsResponse = {
  data: SentenceSnapshotItem[]
  nextCursor: string | null
}

export function useCaseSentenceSnapshots(
  organizationId: string,
  caseId: string,
  enabled = true
) {
  return useQuery<CaseSentenceSnapshotsResponse, ApiError>({
    queryKey: queryKeys.caseSentenceSnapshots(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseSentenceSnapshotsResponse>(`/api/v1/cases/${caseId}/sentence-snapshots`, {
        organizationId,
        signal,
        params: { limit: 50 },
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}

export type ProposeSentenceSnapshotInput = {
  effectiveAt: string
  totalSentenceDays: number
  servedDays?: number
  remissionDays?: number
  detractionDays?: number
  confidenceLevel?: string
  calculationMethod?: string
  sourceDocumentIds?: string[]
  crimesBreakdown?: any[]
  isGenericRecidivist?: boolean
}

export type SupersedeSentenceSnapshotInput = ProposeSentenceSnapshotInput & {
  reason: string
}

export function useProposeSentenceSnapshot(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: SentenceSnapshotItem }, ApiError, ProposeSentenceSnapshotInput>({
    mutationFn: (input) =>
      apiPost<{ data: SentenceSnapshotItem }>(
        `/api/v1/cases/${caseId}/sentence-snapshots`,
        input,
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseSentenceSnapshots(organizationId, caseId) })
    },
  })
}

export function useConfirmSentenceSnapshot(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: SentenceSnapshotItem }, ApiError, string>({
    mutationFn: (snapshotId) =>
      apiPost<{ data: SentenceSnapshotItem }>(
        `/api/v1/sentence-snapshots/${snapshotId}/confirm`,
        {},
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseSentenceSnapshots(organizationId, caseId) })
      // Invalidar também oportunidades/prazos pois mudando o snapshot recalcularemos os dados
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseDeadlines(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueProjections(organizationId) })
    },
  })
}

export function useSupersedeSentenceSnapshot(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: { superseded: SentenceSnapshotItem; replacement: SentenceSnapshotItem } }, ApiError, { snapshotId: string; input: SupersedeSentenceSnapshotInput }>({
    mutationFn: ({ snapshotId, input }) =>
      apiPost<{ data: { superseded: SentenceSnapshotItem; replacement: SentenceSnapshotItem } }>(
        `/api/v1/sentence-snapshots/${snapshotId}/supersede`,
        input,
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseSentenceSnapshots(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseDeadlines(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueProjections(organizationId) })
    },
  })
}
