/**
 * Document detail — GET /api/v1/documents/:id
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type DocumentCaseSummary = {
  id: string
  internalRef: string
}

export type DocumentClientSummary = {
  id: string
  fullName: string
  displayName: string | null
}

export type DocumentExtractionSummary = {
  extractionRunId: string
  status: string
  extractionType: string
  confidence: string
  extractedAt: string
  reviewHistory: Array<{
    decision: string
    reason: string
    reviewerUserId: string
    reviewedAt: string
  }>
}

export type DocumentSnapshotPromotionSummary = {
  id: string
  status: string
  snapshotKind: string
  snapshotId: string | null
  promotedAt: string | null
}

export type DocumentDetail = {
  id: string
  organizationId: string
  fileName: string
  mimeType: string
  byteSize: number
  documentClass: string | null
  status: string
  ocrStatus: string
  sourceChannel: string
  sensitivityLevel: string
  uploadedAt: string
  updatedAt: string
  confirmedAt: string | null
  confirmedByUserId: string | null
  clientId: string | null
  executionCaseId: string | null
  intakeBundleId: string | null
  clientSummary: DocumentClientSummary | null
  caseSummary: DocumentCaseSummary | null
  extraction: DocumentExtractionSummary | null
  snapshotPromotion: DocumentSnapshotPromotionSummary | null
}

type DocumentDetailResponse = {
  data: DocumentDetail
}

export function useDocument(organizationId: string, documentId: string, enabled = true) {
  return useQuery<DocumentDetailResponse, ApiError>({
    queryKey: queryKeys.document(organizationId, documentId),
    queryFn: ({ signal }) =>
      apiGet<DocumentDetailResponse>(`/api/v1/documents/${documentId}`, {
        organizationId,
        signal,
      }),
    staleTime: 60 * 1000,
    enabled: organizationId !== '' && documentId !== '' && enabled,
  })
}
