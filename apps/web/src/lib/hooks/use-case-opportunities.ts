/**
 * Case opportunities list — GET /api/v1/cases/:caseId/opportunities
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type CaseOpportunityItem = {
  id: string
  organizationId: string
  executionCaseId: string
  opportunityType: string
  status: string
  detectedAt: string
  qualifiedAt: string | null
  qualifiedByUserId: string | null
  windowStartAt: string | null
  windowEndAt: string | null
  summary: string
  rationale: string | null
  confidenceLevel: string | null
  requiresReview: boolean
  isPendingReview: boolean
  isBlocked: boolean
  isStale: boolean
  blockingConditions?: Array<{ condition: string; type: string; entityRef?: string }> | null
  requiredDocuments?: Array<{ required: string; reason: string; urgency: string }> | null
  missingDataFields?: Array<{ field: string; source: string; reason: string }> | null
  uncertaintyFlags?: Array<{ factor: string; impact: string; description: string }> | null
  createdAt: string
  updatedAt: string
}

type CaseOpportunitiesResponse = {
  data: CaseOpportunityItem[]
  nextCursor: string | null
}

export function useCaseOpportunities(
  organizationId: string,
  caseId: string,
  enabled = true
) {
  return useQuery<CaseOpportunitiesResponse, ApiError>({
    queryKey: queryKeys.caseOpportunities(organizationId, caseId),
    queryFn: ({ signal }) =>
      apiGet<CaseOpportunitiesResponse>(`/api/v1/cases/${caseId}/opportunities`, {
        organizationId,
        signal,
        params: { limit: 50 },
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && caseId !== '' && enabled,
  })
}

export type ReviewOpportunityInput = {
  reviewAction:
    | 'qualified'
    | 'rejected'
    | 'changes_requested'
    | 'deferred'
    | 'escalated'
    | 'pursuing_started'
    | 'realized'
  explanation: string
  rejectionReasonCode?:
    | 'not_applicable'
    | 'data_insufficient'
    | 'timing_not_met'
    | 'prior_dismissal'
    | 'superseded'
    | 'other'
  deferredUntil?: string
  escalatedToUserId?: string
  realizedPieceDraftId?: string
  dataSnapshotRef?: Record<string, unknown>
}

export type DeferOpportunityInput = {
  deferredUntil: string
  explanation: string
}

export function useReviewOpportunity(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: CaseOpportunityItem }, ApiError, { opportunityId: string; input: ReviewOpportunityInput }>({
    mutationFn: ({ opportunityId, input }) =>
      apiPost<{ data: CaseOpportunityItem }>(
        `/api/v1/opportunities/${opportunityId}/review`,
        input,
        { organizationId }
      ),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseDeadlines(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseTimeline(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueProjections(organizationId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.engineRuns(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.opportunityReviews(organizationId, variables.opportunityId) })
    },
  })
}

export function useDeferOpportunity(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: CaseOpportunityItem }, ApiError, { opportunityId: string; input: DeferOpportunityInput }>({
    mutationFn: ({ opportunityId, input }) =>
      apiPost<{ data: CaseOpportunityItem }>(
        `/api/v1/opportunities/${opportunityId}/defer`,
        input,
        { organizationId }
      ),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseDeadlines(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseTimeline(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueProjections(organizationId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.engineRuns(organizationId, caseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.opportunityReviews(organizationId, variables.opportunityId) })
    },
  })
}

export type OpportunityReviewItem = {
  id: string
  opportunityId: string
  reviewAction: string
  reviewerUserId: string
  explanation: string
  rejectionReasonCode: string | null
  deferredUntil: string | null
  escalatedToUserId: string | null
  opportunityStatusAtReview: string
  confidenceLevelAtReview: string | null
  reviewedAt: string
}

export function useOpportunityReviews(
  organizationId: string,
  opportunityId: string,
  enabled = true
) {
  return useQuery<{ data: OpportunityReviewItem[] }, ApiError>({
    queryKey: queryKeys.opportunityReviews(organizationId, opportunityId),
    queryFn: ({ signal }) =>
      apiGet<{ data: OpportunityReviewItem[] }>(`/api/v1/opportunities/${opportunityId}/reviews`, {
        organizationId,
        signal,
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && opportunityId !== '' && enabled,
  })
}

// -------------------------------------------------------------------------
// Piece Drafts (Claude AI Integration)
// -------------------------------------------------------------------------

export type PieceDraftItem = {
  id: string
  organizationId: string
  executionCaseId: string
  opportunityId: string
  status: string
  contentMarkdown: string | null
  modelUsed: string | null
  createdAt: string
  updatedAt: string
  finalizedAt: string | null
}

export function useGeneratePieceDraft(organizationId: string, caseId: string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: PieceDraftItem }, ApiError, { opportunityId: string; instructions?: string }>({
    mutationFn: ({ opportunityId, instructions }) =>
      apiPost<{ data: PieceDraftItem }>(
        `/api/v1/piece-drafts/generate/${opportunityId}`,
        { instructions },
        { organizationId }
      ),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.caseOpportunities(organizationId, caseId) })
    },
  })
}

export function usePieceDraft(
  organizationId: string,
  draftId: string | null,
  enabled = true
) {
  return useQuery<PieceDraftItem, ApiError>({
    queryKey: ['piece-drafts', organizationId, draftId],
    queryFn: ({ signal }) =>
      apiGet<PieceDraftItem>(`/api/v1/piece-drafts/${draftId}`, {
        organizationId,
        signal,
      }),
    staleTime: 0, // Drafts update often
    enabled: organizationId !== '' && !!draftId && enabled,
  })
}

export function useUpdatePieceDraft(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation<PieceDraftItem, ApiError, { draftId: string; contentMarkdown: string; finalize?: boolean }>({
    mutationFn: ({ draftId, contentMarkdown, finalize }) =>
      apiPut<PieceDraftItem>(
        `/api/v1/piece-drafts/${draftId}`,
        { contentMarkdown, finalize },
        { organizationId }
      ),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['piece-drafts', organizationId, variables.draftId] })
    },
  })
}
