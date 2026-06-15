/**
 * Snapshot promotion domain event contracts.
 */

export const SNAPSHOT_PROMOTION_REQUESTED = 'snapshot.promotion.requested' as const
export const SNAPSHOT_PROPOSED = 'snapshot.proposed' as const
export const SNAPSHOT_CONFIRMED = 'snapshot.confirmed' as const
export const SNAPSHOT_REJECTED = 'snapshot.rejected' as const

export type SnapshotKind = 'sentence' | 'custody'

export type SnapshotPromotionRequestedPayload = {
  promotionId: string
  sourceDocumentId: string
  extractionRunId: string
  executionCaseId: string
  organizationId: string
  snapshotKind: SnapshotKind
  extractionType: string
}

export type SnapshotProposedPayload = {
  promotionId: string
  snapshotId: string
  snapshotKind: SnapshotKind
  sourceDocumentId: string
  extractionRunId: string
  executionCaseId: string
  organizationId: string
  extractionType: string
}

export type SnapshotConfirmedPayload = {
  snapshotId: string
  snapshotKind: SnapshotKind
  executionCaseId: string
  organizationId: string
  confirmedByUserId: string
  promotionId?: string
}

export function parseSnapshotPromotionRequestedPayload(
  payload: Record<string, unknown>
): SnapshotPromotionRequestedPayload | null {
  const promotionId = typeof payload['promotionId'] === 'string' ? payload['promotionId'] : null
  const sourceDocumentId =
    typeof payload['sourceDocumentId'] === 'string' ? payload['sourceDocumentId'] : null
  const extractionRunId =
    typeof payload['extractionRunId'] === 'string' ? payload['extractionRunId'] : null
  const executionCaseId =
    typeof payload['executionCaseId'] === 'string' ? payload['executionCaseId'] : null
  const organizationId =
    typeof payload['organizationId'] === 'string' ? payload['organizationId'] : null
  const snapshotKind = payload['snapshotKind']
  const extractionType =
    typeof payload['extractionType'] === 'string' ? payload['extractionType'] : null
  if (
    promotionId === null ||
    sourceDocumentId === null ||
    extractionRunId === null ||
    executionCaseId === null ||
    organizationId === null ||
    extractionType === null ||
    (snapshotKind !== 'sentence' && snapshotKind !== 'custody')
  ) {
    return null
  }
  return {
    promotionId,
    sourceDocumentId,
    extractionRunId,
    executionCaseId,
    organizationId,
    snapshotKind,
    extractionType,
  }
}

export function parseSnapshotConfirmedPayload(
  payload: Record<string, unknown>
): SnapshotConfirmedPayload | null {
  const snapshotId = typeof payload['snapshotId'] === 'string' ? payload['snapshotId'] : null
  const executionCaseId =
    typeof payload['executionCaseId'] === 'string' ? payload['executionCaseId'] : null
  const organizationId =
    typeof payload['organizationId'] === 'string' ? payload['organizationId'] : null
  const confirmedByUserId =
    typeof payload['confirmedByUserId'] === 'string' ? payload['confirmedByUserId'] : null
  const snapshotKind = payload['snapshotKind'] ?? payload['snapshot_kind']
  if (
    snapshotId === null ||
    executionCaseId === null ||
    organizationId === null ||
    confirmedByUserId === null ||
    (snapshotKind !== 'sentence' && snapshotKind !== 'custody')
  ) {
    return null
  }
  return {
    snapshotId,
    snapshotKind,
    executionCaseId,
    organizationId,
    confirmedByUserId,
    ...(typeof payload['promotionId'] === 'string' ? { promotionId: payload['promotionId'] } : {}),
  }
}
