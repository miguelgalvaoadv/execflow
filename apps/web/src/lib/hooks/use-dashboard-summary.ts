/**
 * Resumo da dashboard — contagens REAIS (COUNT no banco), não tamanho de página.
 * GET /api/v1/dashboard/summary
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'

export type DashboardSummary = {
  activeCases: number
  activeClients: number
  newIntimations: number
  overdueDeadlines: number
  weekDeadlines: number
  openTasks: number
  openOpportunities: number
  todayEvents: number
}

export function useDashboardSummary(organizationId: string, enabled = true) {
  return useQuery<DashboardSummary, ApiError>({
    queryKey: ['dashboard-summary', organizationId],
    queryFn: ({ signal }) =>
      apiGet<DashboardSummary>('/api/v1/dashboard/summary', { organizationId, signal }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}
