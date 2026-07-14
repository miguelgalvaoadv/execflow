/**
 * Agenda / calendário — GET /api/v1/calendar (agregado por intervalo) + CRUD.
 *
 * O calendário mescla eventos manuais + prazos + oportunidades por período.
 * "Adicionar à agenda" num prazo/oportunidade cria um vínculo (sourceDeadlineId
 * / sourceOpportunityId) via o mesmo POST.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CalendarItem = {
  id: string
  kind: 'manual' | 'deadline' | 'opportunity'
  eventKind: string | null
  title: string
  description: string | null
  startsAt: string
  endsAt: string | null
  allDay: boolean
  location: string | null
  color: string | null
  executionCaseId: string | null
  clientName: string | null
  processNumber: string | null
  deadlineStatus: string | null
  deadlinePriority: string | null
  opportunityType: string | null
  sourceType: string | null
  sourceId: string | null
  editable: boolean
}

export type CalendarLayer = 'manual' | 'deadlines' | 'opportunities'

export function useCalendar(
  organizationId: string,
  from: string,
  to: string,
  layers: CalendarLayer[],
  enabled = true
) {
  const layersCsv = layers.join(',')
  return useQuery<{ data: CalendarItem[] }, ApiError>({
    queryKey: queryKeys.calendar(organizationId, from, to, layersCsv),
    queryFn: ({ signal }) =>
      apiGet('/api/v1/calendar', {
        organizationId,
        signal,
        params: { from, to, layers: layersCsv },
      }),
    staleTime: 20 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}

export type CreateEventInput = {
  title?: string
  description?: string | null
  startsAt?: string
  endsAt?: string | null
  allDay?: boolean
  location?: string | null
  eventKind?: string
  color?: string | null
  executionCaseId?: string | null
  sourceDeadlineId?: string
  sourceOpportunityId?: string
}

export function useCreateCalendarEvent(organizationId: string) {
  const qc = useQueryClient()
  return useMutation<{ data: unknown }, ApiError, CreateEventInput>({
    mutationFn: (input) => apiPost('/api/v1/calendar', input, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar', organizationId] })
    },
  })
}

export type UpdateEventInput = {
  title?: string
  description?: string | null
  startsAt?: string
  endsAt?: string | null
  allDay?: boolean
  location?: string | null
  eventKind?: string
  color?: string | null
  executionCaseId?: string | null
}

export function useUpdateCalendarEvent(organizationId: string) {
  const qc = useQueryClient()
  return useMutation<{ data: unknown }, ApiError, { id: string; input: UpdateEventInput }>({
    mutationFn: ({ id, input }) => apiPatch(`/api/v1/calendar/${id}`, input, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar', organizationId] })
    },
  })
}

export function useDeleteCalendarEvent(organizationId: string) {
  const qc = useQueryClient()
  return useMutation<{ data: unknown }, ApiError, string>({
    mutationFn: (id) => apiDelete(`/api/v1/calendar/${id}`, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar', organizationId] })
    },
  })
}
