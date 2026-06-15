/**
 * Engine runs hooks — reads from GET /api/v1/engine/runs.
 *
 * Types reflect the JSON API shape (ISO date strings), not Drizzle row types.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

/** API list/detail shape — subset of engine run fields used by operational surfaces. */
export type EngineRunListItem = {
  id: string
  organizationId: string
  executionCaseId: string
  playbookVersionId: string
  status: string
  trigger: string
  isReplay: boolean
  evaluatedAt: string
  completedAt: string | null
  opportunitiesCreated: unknown[] | null
  blockingCodes: string[] | null
  uncertaintyLevel: string | null
  warningsEmitted: unknown[] | null
  requestedByUserId: string | null
}

type EngineRunsResponse = {
  data: EngineRunListItem[]
  count: number
}

export function useEngineRuns(
  organizationId: string,
  caseId?: string,
  enabled = true,
  limit = 20
) {
  return useQuery<EngineRunsResponse, ApiError>({
    queryKey: queryKeys.engineRuns(organizationId, caseId, limit),
    queryFn: ({ signal }) =>
      apiGet<EngineRunsResponse>('/api/v1/engine/runs', {
        organizationId,
        signal,
        params: { ...(caseId !== undefined ? { caseId } : {}), limit },
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}

export function useEngineRun(organizationId: string, runId: string) {
  return useQuery<{ data: EngineRunListItem }, ApiError>({
    queryKey: queryKeys.engineRun(organizationId, runId),
    queryFn: ({ signal }) =>
      apiGet<{ data: EngineRunListItem }>(`/api/v1/engine/runs/${runId}`, {
        organizationId,
        signal,
      }),
    staleTime: 5 * 60 * 1000,
    enabled: organizationId !== '' && runId !== '',
  })
}

export function useEvaluateEngine(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<any, ApiError, void>({
    mutationFn: () =>
      apiPost('/api/v1/engine/evaluate', { caseId }, { organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.engineRuns(organizationId, caseId, 20) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueProjections(organizationId) })
    },
  })
}
