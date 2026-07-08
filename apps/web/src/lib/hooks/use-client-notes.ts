/**
 * Client notes — bloquinho de observações por cliente.
 * GET/POST /api/v1/clients/:clientId/notes, PATCH/DELETE .../notes/:noteId
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type ClientNote = {
  id: string
  organizationId: string
  clientId: string
  body: string
  createdByUserId: string
  createdAt: string
  updatedByUserId: string | null
  updatedAt: string
}

type ClientNotesResponse = { data: ClientNote[] }
type ClientNoteResponse = { data: ClientNote }

export function useClientNotes(organizationId: string, clientId: string, enabled = true) {
  return useQuery<ClientNotesResponse, ApiError>({
    queryKey: queryKeys.clientNotes(organizationId, clientId),
    queryFn: ({ signal }) =>
      apiGet<ClientNotesResponse>(`/api/v1/clients/${clientId}/notes`, {
        organizationId,
        signal,
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && clientId !== '' && enabled,
  })
}

export function useCreateClientNote(organizationId: string, clientId: string) {
  const queryClient = useQueryClient()
  return useMutation<ClientNoteResponse, ApiError, string>({
    mutationFn: (body: string) =>
      apiPost<ClientNoteResponse>(`/api/v1/clients/${clientId}/notes`, { body }, { organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clientNotes(organizationId, clientId) })
    },
  })
}

export function useUpdateClientNote(organizationId: string, clientId: string) {
  const queryClient = useQueryClient()
  return useMutation<ClientNoteResponse, ApiError, { noteId: string; body: string }>({
    mutationFn: ({ noteId, body }) =>
      apiPatch<ClientNoteResponse>(`/api/v1/clients/${clientId}/notes/${noteId}`, { body }, { organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clientNotes(organizationId, clientId) })
    },
  })
}

export function useDeleteClientNote(organizationId: string, clientId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ data: { deleted: boolean } }, ApiError, string>({
    mutationFn: (noteId: string) =>
      apiDelete<{ data: { deleted: boolean } }>(`/api/v1/clients/${clientId}/notes/${noteId}`, { organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clientNotes(organizationId, clientId) })
    },
  })
}
