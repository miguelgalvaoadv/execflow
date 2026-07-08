/**
 * Case notes — bloquinho de observações por processo (execução).
 * GET/POST /api/v1/cases/:caseId/notes, PATCH/DELETE .../notes/:noteId
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CaseNote = {
  id: string
  organizationId: string
  executionCaseId: string
  body: string
  createdByUserId: string
  createdAt: string
  updatedByUserId: string | null
  updatedAt: string
}

type CaseNotesResponse = { data: CaseNote[] }
type CaseNoteResponse = { data: CaseNote }

export function useCaseNotes(organizationId: string, caseId: string, enabled = true) {
  return useQuery<CaseNotesResponse, ApiError>({
    queryKey: queryKeys.caseNotes(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseNotesResponse>(`/api/v1/cases/${caseId}/notes`, {
        organizationId,
        signal,
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}

export function useCreateCaseNote(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<CaseNoteResponse, ApiError, string>({
    mutationFn: (body: string) =>
      apiPost<CaseNoteResponse>(`/api/v1/cases/${caseId}/notes`, { body }, { organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseNotes(organizationId, caseId) })
    },
  })
}

export function useUpdateCaseNote(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<CaseNoteResponse, ApiError, { noteId: string; body: string }>({
    mutationFn: ({ noteId, body }) =>
      apiPatch<CaseNoteResponse>(`/api/v1/cases/${caseId}/notes/${noteId}`, { body }, { organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseNotes(organizationId, caseId) })
    },
  })
}

export function useDeleteCaseNote(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ data: { deleted: boolean } }, ApiError, string>({
    mutationFn: (noteId: string) =>
      apiDelete<{ data: { deleted: boolean } }>(`/api/v1/cases/${caseId}/notes/${noteId}`, { organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseNotes(organizationId, caseId) })
    },
  })
}
