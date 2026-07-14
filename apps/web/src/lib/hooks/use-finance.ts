/**
 * Financeiro — lançamentos manuais por cliente.
 *
 * GET   /api/v1/finance/entries?clientId=...
 * POST  /api/v1/finance/entries
 * PATCH /api/v1/finance/entries/:id
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type FinancialEntryDirection = 'receivable' | 'expense'
export type FinancialEntryStatus = 'pending' | 'paid' | 'cancelled'

export type FinancialEntry = {
  id: string
  organizationId: string
  clientId: string
  executionCaseId: string | null
  direction: FinancialEntryDirection
  category: string
  description: string
  amount: string
  dueDate: string | null
  paidAt: string | null
  paymentMethod: string | null
  status: FinancialEntryStatus
  notes: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
  isOverdue: boolean
}

export type FinancialSummary = {
  receivablePending: number
  receivablePaid: number
  receivableOverdue: number
  expensePending: number
  expensePaid: number
}

type ListResponse = { data: FinancialEntry[]; summary: FinancialSummary }

export function useFinancialEntries(organizationId: string, clientId: string, enabled = true) {
  return useQuery<ListResponse, ApiError>({
    queryKey: queryKeys.financialEntries(organizationId, clientId),
    queryFn: ({ signal }) =>
      apiGet<ListResponse>('/api/v1/finance/entries', {
        organizationId,
        signal,
        params: { clientId },
      }),
    staleTime: 20 * 1000,
    enabled: organizationId !== '' && clientId !== '' && enabled,
  })
}

export type CreateFinancialEntryInput = {
  clientId: string
  executionCaseId?: string
  direction: FinancialEntryDirection
  category: string
  description: string
  amount: number
  dueDate?: string
  paymentMethod?: string
  status?: FinancialEntryStatus
  notes?: string
}

export function useCreateFinancialEntry(organizationId: string, clientId: string) {
  const qc = useQueryClient()
  return useMutation<{ data: FinancialEntry }, ApiError, CreateFinancialEntryInput>({
    mutationFn: (input) => apiPost('/api/v1/finance/entries', input, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.financialEntries(organizationId, clientId) })
    },
  })
}

export type UpdateFinancialEntryInput = {
  id: string
  direction?: FinancialEntryDirection
  category?: string
  description?: string
  amount?: number
  dueDate?: string | null
  paymentMethod?: string | null
  status?: FinancialEntryStatus
  notes?: string | null
}

export function useUpdateFinancialEntry(organizationId: string, clientId: string) {
  const qc = useQueryClient()
  return useMutation<{ data: FinancialEntry }, ApiError, UpdateFinancialEntryInput>({
    mutationFn: ({ id, ...input }) =>
      apiPatch(`/api/v1/finance/entries/${id}`, input, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.financialEntries(organizationId, clientId) })
    },
  })
}
