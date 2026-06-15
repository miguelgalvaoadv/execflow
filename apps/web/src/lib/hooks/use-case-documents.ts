import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CaseDocumentItem = {
  id: string
  organizationId: string
  clientId: string | null
  executionCaseId: string | null
  documentClass: string | null
  sensitivityLevel: string
  fileName: string
  mimeType: string
  byteSize: number
  status: string
  ocrStatus: string
  sourceChannel: string
  uploadedAt: string
  uploadedByUserId: string
  confirmedAt: string | null
  confirmedByUserId: string | null
  updatedAt: string
}

type CaseDocumentsResponse = {
  data: CaseDocumentItem[]
  nextCursor: string | null
}

export function useCaseDocuments(
  organizationId: string,
  caseId: string,
  enabled = true
) {
  return useQuery<CaseDocumentsResponse, ApiError>({
    queryKey: queryKeys.caseDocuments(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseDocumentsResponse>(`/api/v1/cases/${caseId}/documents`, {
        organizationId,
        signal,
        params: { limit: 50 },
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}

export type RequestUploadResponse = {
  uploadId: string
  uploadToken: string
  storageKey: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

export type RequestUploadInput = {
  fileName: string
  mimeType: string
  byteSize: number
  checksumSha256: string
  sourceChannel: string
}

export type CompleteUploadInput = {
  uploadToken: string
  clientId?: string
  executionCaseId?: string
  intakeBundleId?: string
  documentClass?: string
  sensitivityLevel?: 'public' | 'standard' | 'sensitive' | 'restricted'
}

export function useRequestUpload(organizationId: string) {
  return useMutation<{ data: RequestUploadResponse }, ApiError, RequestUploadInput>({
    mutationFn: (input) =>
      apiPost<{ data: RequestUploadResponse }>(
        '/api/v1/uploads/request',
        input,
        { organizationId }
      ),
  })
}

export function useCompleteUpload(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: CaseDocumentItem }, ApiError, CompleteUploadInput>({
    mutationFn: (input) =>
      apiPost<{ data: CaseDocumentItem }>(
        '/api/v1/uploads/complete',
        input,
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseDocuments(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseTimeline(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueProjections(organizationId) })
    },
  })
}

