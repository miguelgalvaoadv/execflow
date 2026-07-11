/**
 * Execution case detail — GET /api/v1/cases/:id
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CaseClientSummary = {
  id: string
  fullName: string
  displayName: string | null
}

export type ExecutionCaseDetail = {
  id: string
  organizationId: string
  clientId: string
  internalRef: string
  executionProcessNumber: string | null
  originProcessNumber: string | null
  courtName: string | null
  courtJurisdiction: string | null
  caseKind: string
  parentExecutionCaseId: string | null
  status: string
  responsibleLawyerUserId: string | null
  sentenceSummary: string | null
  openedAt: string
  closedAt: string | null
  closedReason: string | null
  processNumberPendingSince: string | null
  monitoringStatus: string | null
  lastSyncedAt: string | null
  astreaSealedCredentialStatus: string | null
  astreaSealedCredentialUpdatedAt: string | null
  astreaSealedCredentialReviewDueAt: string | null
  documentFreshnessStatus: string | null
  autosLastIngestedAt: string | null
  pendingCriticalMovementSince: string | null
  pendingCriticalMovementType: string | null
  createdAt: string
  createdByUserId: string
  updatedAt: string
  deletedAt: string | null
  clientSummary: CaseClientSummary
}

type CaseDetailResponse = {
  data: ExecutionCaseDetail
}

export function useCase(organizationId: string, caseId: string, enabled = true) {
  return useQuery<CaseDetailResponse, ApiError>({
    queryKey: queryKeys.case(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseDetailResponse>(`/api/v1/cases/${caseId}`, {
        organizationId,
        signal,
      }),
    staleTime: 60 * 1000,
    // Repolla com a tela aberta — monitoringStatus/documentFreshnessStatus
    // mudam por sincronização automática (cron), sem clique nenhum. Mesmo
    // motivo de use-case-timeline.ts.
    refetchInterval: 90 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}
