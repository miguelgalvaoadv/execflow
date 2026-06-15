/**
 * Org document list — GET /api/v1/documents
 */

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type DocumentListItem = {
  id: string
  fileName: string
  documentClass: string | null
  status: string
  ocrStatus: string
  uploadedAt: string
  executionCaseId: string | null
  caseInternalRef: string | null
}

type DocumentsListResponse = {
  data: DocumentListItem[]
  nextCursor: string | null
}

export type DocumentsListFilters = {
  status?: string
  documentClass?: string
  q?: string
}

type UseDocumentsOptions = {
  organizationId: string
  filters?: DocumentsListFilters
  limit?: number
  enabled?: boolean
}

export function useDocuments({
  organizationId,
  filters,
  limit = 50,
  enabled = true,
}: UseDocumentsOptions) {
  return useInfiniteQuery<
    DocumentsListResponse,
    ApiError,
    InfiniteData<DocumentsListResponse>,
    ReturnType<typeof queryKeys.documents>,
    string | undefined
  >({
    queryKey: queryKeys.documents(organizationId, filters),
    queryFn: ({ pageParam, signal }) =>
      apiGet<DocumentsListResponse>('/api/v1/documents', {
        organizationId,
        signal,
        params: {
          limit,
          cursor: pageParam,
          status: filters?.status,
          documentClass: filters?.documentClass,
          q: filters?.q,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}
