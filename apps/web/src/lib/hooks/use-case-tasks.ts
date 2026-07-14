/**
 * Tarefas de UM caso — GET /api/v1/queue/workflow-tasks?executionCaseId=...
 *
 * Mesmo endpoint da tela geral (/tasks), só filtrado pelo caso — igual ao
 * padrão já usado em use-case-communications.ts.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CaseWorkflowTask = {
  id: string
  taskType: string
  title: string
  description: string | null
  status: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  executionCaseId: string | null
  claimedByUserId: string | null
  assignedToUserId: string | null
  dueAt: string | null
  createdAt: string
}

type CaseTasksResponse = { data: CaseWorkflowTask[] }

export function useCaseTasks(organizationId: string, caseId: string, enabled = true) {
  return useQuery<CaseTasksResponse, ApiError>({
    queryKey: queryKeys.caseTasks(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseTasksResponse>('/api/v1/queue/workflow-tasks', {
        organizationId,
        signal,
        params: { executionCaseId: caseId, limit: 100 },
      }),
    staleTime: 20 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}

export function useCaseTaskAction(organizationId: string, caseId: string) {
  const qc = useQueryClient()
  return useMutation<unknown, ApiError, { taskId: string; verb: 'claim' | 'release' | 'complete' }>({
    mutationFn: ({ taskId, verb }) =>
      apiPost(`/api/v1/queue/workflow-tasks/${taskId}/${verb}`, {}, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.caseTasks(organizationId, caseId) })
      // Mesma tabela da tela geral — invalida também.
      void qc.invalidateQueries({ queryKey: ['workflow-tasks', organizationId] })
    },
  })
}

export function useCreateCaseTask(organizationId: string, caseId: string) {
  const qc = useQueryClient()
  return useMutation<
    unknown,
    ApiError,
    { title: string; description?: string; priority?: string; dueAt?: string }
  >({
    mutationFn: (input) =>
      apiPost(
        '/api/v1/queue/workflow-tasks',
        { ...input, executionCaseId: caseId },
        { organizationId }
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.caseTasks(organizationId, caseId) })
      void qc.invalidateQueries({ queryKey: ['workflow-tasks', organizationId] })
    },
  })
}
