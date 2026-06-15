/**
 * Deadline lifecycle mutations — acknowledge, complete, dismiss.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'
import type { DeadlineDetail } from './use-deadline'

type DeadlineMutationResponse = {
  data: DeadlineDetail
}

type DismissInput = {
  dismissedReason: string
  dismissedReasonCode?: string
}

export function useAcknowledgeDeadline(organizationId: string, deadlineId: string) {
  const queryClient = useQueryClient()

  return useMutation<DeadlineMutationResponse, ApiError, void>({
    mutationFn: () =>
      apiPost<DeadlineMutationResponse>(
        `/api/v1/deadlines/${deadlineId}/acknowledge`,
        {},
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deadline(organizationId, deadlineId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.deadlineHistory(organizationId, deadlineId) })
      void queryClient.invalidateQueries({ queryKey: ['deadlines', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['case-deadlines', organizationId] })
    },
  })
}

export type CompleteDeadlineInput = {
  completionEvidenceType?: 'timeline_event' | 'document' | 'manual' | 'filing' | 'court_event' | 'note' | 'other'
  completionEvidenceId?: string
  reason?: string
}

export function useCompleteDeadline(organizationId: string, deadlineId: string) {
  const queryClient = useQueryClient()

  return useMutation<DeadlineMutationResponse, ApiError, CompleteDeadlineInput | undefined>({
    mutationFn: (input) =>
      apiPost<DeadlineMutationResponse>(
        `/api/v1/deadlines/${deadlineId}/complete`,
        input ?? {},
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deadline(organizationId, deadlineId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.deadlineHistory(organizationId, deadlineId) })
      void queryClient.invalidateQueries({ queryKey: ['deadlines', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['case-deadlines', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['queue-projections', organizationId] })
    },
  })
}

export function useDismissDeadline(organizationId: string, deadlineId: string) {
  const queryClient = useQueryClient()

  return useMutation<DeadlineMutationResponse, ApiError, DismissInput>({
    mutationFn: (input) =>
      apiPost<DeadlineMutationResponse>(
        `/api/v1/deadlines/${deadlineId}/dismiss`,
        input,
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deadline(organizationId, deadlineId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.deadlineHistory(organizationId, deadlineId) })
      void queryClient.invalidateQueries({ queryKey: ['deadlines', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['case-deadlines', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['queue-projections', organizationId] })
    },
  })
}

export type CreateDeadlineInput = {
  executionCaseId: string
  title: string
  description?: string
  dueAt: string
  deadlineClass: string
  origin: string
  priority?: string
  assigneeUserId?: string
  sourceEventId?: string
  sourceDocumentId?: string
  playbookVersionId?: string
  legalBasis?: string
  parentDeadlineId?: string
}

export function useCreateDeadline(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<DeadlineMutationResponse, ApiError, CreateDeadlineInput>({
    mutationFn: (input) =>
      apiPost<DeadlineMutationResponse>(
        '/api/v1/deadlines',
        input,
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseDeadlines(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: ['deadlines', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['queue-projections', organizationId] })
    },
  })
}

