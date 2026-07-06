/**
 * Inventário por OAB — hooks de leitura e mutação.
 *
 * GET  /api/v1/inventory/profiles        (perfis + contadores agregados)
 * GET  /api/v1/inventory/items           (itens com filtros)
 * POST /api/v1/inventory/profiles        (criar perfil)
 * POST /api/v1/inventory/import          (importar lote CSV/XLSX parseado)
 * POST /api/v1/inventory/classify        (reclassificar prioridade)
 * PATCH /api/v1/inventory/items/:id      (triagem)
 * POST /api/v1/inventory/items/:id/promote (promover a caso)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type OabProfile = {
  id: string
  lawyerName: string
  oabNumber: string
  oabUf: string
  primaryTribunal: string | null
  primarySystem: string | null
  searchSource: string
  searchStatus: string
  lastSyncedAt: string | null
  lastSyncError: string | null
  createdAt: string
}

export type InventoryCounters = {
  total: number
  active: number
  archived: number
  highPriority: number
  needsAutos: number
  sealed: number
  withoutClient: number
  unreviewed: number
  promoted: number
}

export type InventoryItem = {
  id: string
  oabProfileId: string | null
  processNumber: string
  tribunal: string | null
  degree: string | null
  system: string | null
  comarca: string | null
  vara: string | null
  courtClass: string | null
  area: string | null
  situation: string | null
  partiesText: string | null
  link: string | null
  lastMovementText: string | null
  lastMovementAt: string | null
  priority: 'high' | 'medium' | 'low' | null
  priorityReason: string | null
  needsAutos: boolean
  autosDownloaded: boolean
  isSealed: boolean
  reviewStatus: 'unreviewed' | 'confirmed' | 'not_ours' | 'archived'
  clientId: string | null
  executionCaseId: string | null
  sourceInfo: string
  importBatchId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type InventoryItemsFilters = {
  priority?: string
  reviewStatus?: string
  needsAutos?: string
  withoutClient?: string
  q?: string
}

export type ImportRow = {
  processNumber: string
  tribunal?: string
  degree?: string
  system?: string
  comarca?: string
  vara?: string
  courtClass?: string
  area?: string
  situation?: string
  partiesText?: string
  link?: string
  lastMovementText?: string
  lastMovementAt?: string
  notes?: string
}

export type ImportResult = {
  batchId: string
  created: number
  updated: number
  skipped: number
  classified: number
  errors: Array<{ row: number; processNumber: string; error: string }>
}

export function useInventoryProfiles(organizationId: string, enabled = true) {
  return useQuery<{ data: OabProfile[]; counters: InventoryCounters | null }, ApiError>({
    queryKey: queryKeys.inventoryProfiles(organizationId),
    queryFn: ({ signal }) =>
      apiGet('/api/v1/inventory/profiles', { organizationId, signal }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}

export function useInventoryItems(
  organizationId: string,
  filters: InventoryItemsFilters,
  enabled = true
) {
  return useQuery<{ data: InventoryItem[]; total: number }, ApiError>({
    queryKey: queryKeys.inventoryItems(organizationId, filters),
    queryFn: ({ signal }) =>
      apiGet('/api/v1/inventory/items', {
        organizationId,
        signal,
        params: { ...filters, limit: 300 },
      }),
    staleTime: 15 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}

function useInvalidateInventory(organizationId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory-profiles', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['inventory-items', organizationId] })
  }
}

export function useCreateOabProfile(organizationId: string) {
  const invalidate = useInvalidateInventory(organizationId)
  return useMutation<
    { data: OabProfile },
    ApiError,
    { lawyerName: string; oabNumber: string; oabUf: string; primaryTribunal?: string; primarySystem?: string }
  >({
    mutationFn: (body) => apiPost('/api/v1/inventory/profiles', body, { organizationId }),
    onSuccess: invalidate,
  })
}

export function useImportInventory(organizationId: string) {
  const invalidate = useInvalidateInventory(organizationId)
  return useMutation<
    { data: ImportResult },
    ApiError,
    { rows: ImportRow[]; oabProfileId?: string; sourceInfo?: string }
  >({
    mutationFn: (body) => apiPost('/api/v1/inventory/import', body, { organizationId }),
    onSuccess: invalidate,
  })
}

export function useClassifyInventory(organizationId: string) {
  const invalidate = useInvalidateInventory(organizationId)
  return useMutation<{ data: { evaluated: number; changed: number } }, ApiError, void>({
    mutationFn: () => apiPost('/api/v1/inventory/classify', {}, { organizationId }),
    onSuccess: invalidate,
  })
}

export function usePatchInventoryItem(organizationId: string) {
  const invalidate = useInvalidateInventory(organizationId)
  return useMutation<
    { data: InventoryItem },
    ApiError,
    { itemId: string; patch: Partial<Pick<InventoryItem, 'reviewStatus' | 'clientId' | 'needsAutos' | 'autosDownloaded' | 'isSealed' | 'notes'>> & { priority?: 'high' | 'medium' | 'low' } }
  >({
    mutationFn: ({ itemId, patch }) =>
      apiPatch(`/api/v1/inventory/items/${itemId}`, patch, { organizationId }),
    onSuccess: invalidate,
  })
}

export function usePromoteInventoryItem(organizationId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateInventory(organizationId)
  return useMutation<
    { data: { executionCaseId: string; internalRef: string; clientId: string; warning: string | null } },
    ApiError,
    { itemId: string; clientId?: string; newClient?: { fullName: string; cpf?: string } }
  >({
    mutationFn: ({ itemId, ...body }) =>
      apiPost(`/api/v1/inventory/items/${itemId}/promote`, body, { organizationId }),
    onSuccess: () => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['cases', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['clients', organizationId] })
    },
  })
}
