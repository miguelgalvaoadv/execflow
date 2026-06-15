/**
 * Document read service — org list and document detail for Document Central.
 */

import { eq, and, desc } from 'drizzle-orm'
import { snapshotPromotions } from '@execflow/db/schema'
import {
  findDocumentById,
  listDocumentsForOrg as listDocumentsForOrgRepo,
  type DocumentOrgListItem,
  type ListDocumentsForOrgFilters,
} from '../repositories/document.ts'
import { findCaseById } from '../repositories/execution-case.ts'
import { findClientById } from '../repositories/client.ts'
import { findLatestExtractionForDocument } from '../repositories/extraction-run.ts'
import { listReviewDecisionsForSubject } from '../repositories/review-decision.ts'
import {
  ok,
  validationError,
  notFoundError,
  fromRepositoryError,
} from './result.ts'
import { canViewCases, resolveMembershipRole } from '../lib/permissions.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from './result.ts'
import type { AnyTx } from '../lib/db.ts'

export type DocumentOrgListItemResponse = {
  id: string
  fileName: string
  documentClass: string | null
  status: string
  ocrStatus: string
  uploadedAt: string
  executionCaseId: string | null
  caseInternalRef: string | null
}

export type PaginatedDocumentsResponse = {
  items: DocumentOrgListItemResponse[]
  nextCursor: string | null
}

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

export type DocumentDetailView = {
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

function toOrgListItemResponse(item: DocumentOrgListItem): DocumentOrgListItemResponse {
  return {
    id: item.id,
    fileName: item.fileName,
    documentClass: item.documentClass,
    status: item.status,
    ocrStatus: item.ocrStatus,
    uploadedAt: item.uploadedAt.toISOString(),
    executionCaseId: item.executionCaseId,
    caseInternalRef: item.caseInternalRef,
  }
}

async function findLatestSnapshotPromotionForDocument(
  db: AnyTx,
  organizationId: string,
  documentId: string
): Promise<DocumentSnapshotPromotionSummary | null> {
  const [row] = await db
    .select()
    .from(snapshotPromotions)
    .where(
      and(
        eq(snapshotPromotions.organizationId, organizationId),
        eq(snapshotPromotions.sourceDocumentId, documentId)
      )
    )
    .orderBy(desc(snapshotPromotions.createdAt))
    .limit(1)

  if (row === undefined) return null

  return {
    id: row.id,
    status: row.status,
    snapshotKind: row.snapshotKind,
    snapshotId: row.snapshotId,
    promotedAt: row.promotedAt?.toISOString() ?? null,
  }
}

export async function listDocumentsForOrg(
  ctx: ReadContext,
  filters: ListDocumentsForOrgFilters,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedDocumentsResponse>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view documents.')
  }

  const result = await listDocumentsForOrgRepo(ctx.db, ctx.organizationId, filters, {
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
  })

  if (!result.success) {
    if (result.error.code === 'CONSTRAINT') {
      return validationError(result.error.message)
    }
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok({
    items: result.data.items.map(toOrgListItemResponse),
    nextCursor: result.data.nextCursor,
  })
}

export async function getDocumentDetail(
  ctx: ReadContext,
  documentId: string
): Promise<ServiceResult<DocumentDetailView>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view documents.')
  }

  const docResult = await findDocumentById(ctx.db, ctx.organizationId, documentId)
  if (!docResult.success) {
    if (docResult.error.code === 'NOT_FOUND') {
      return notFoundError('Document not found.')
    }
    return fromRepositoryError(docResult.error.code, docResult.error.message, docResult.error.cause)
  }

  const doc = docResult.data

  let caseSummary: DocumentCaseSummary | null = null
  if (doc.executionCaseId !== null) {
    const caseResult = await findCaseById(ctx.db, ctx.organizationId, doc.executionCaseId)
    if (caseResult.success) {
      caseSummary = { id: caseResult.data.id, internalRef: caseResult.data.internalRef }
    }
  }

  let clientSummary: DocumentClientSummary | null = null
  if (doc.clientId !== null) {
    const clientResult = await findClientById(ctx.db, ctx.organizationId, doc.clientId)
    if (clientResult.success) {
      clientSummary = {
        id: clientResult.data.id,
        fullName: clientResult.data.fullName,
        displayName: clientResult.data.displayName,
      }
    }
  }

  let extraction: DocumentExtractionSummary | null = null
  const extractionLoaded = await findLatestExtractionForDocument(
    ctx.db,
    ctx.organizationId,
    documentId
  )
  if (extractionLoaded.success) {
    const history = await listReviewDecisionsForSubject(
      ctx.db,
      ctx.organizationId,
      'extraction',
      extractionLoaded.data.run.id
    )
    extraction = {
      extractionRunId: extractionLoaded.data.run.id,
      status: extractionLoaded.data.run.status,
      extractionType: extractionLoaded.data.run.extractionType,
      confidence: extractionLoaded.data.result.confidence,
      extractedAt: extractionLoaded.data.result.extractedAt.toISOString(),
      reviewHistory: history.success
        ? history.data.map((row) => ({
            decision: row.decision,
            reason: row.reason,
            reviewerUserId: row.reviewerUserId,
            reviewedAt: row.reviewedAt.toISOString(),
          }))
        : [],
    }
  }

  const snapshotPromotion = await findLatestSnapshotPromotionForDocument(
    ctx.db,
    ctx.organizationId,
    documentId
  )

  return ok({
    id: doc.id,
    organizationId: doc.organizationId,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    byteSize: Number(doc.byteSize),
    documentClass: doc.documentClass,
    status: doc.status,
    ocrStatus: doc.ocrStatus,
    sourceChannel: doc.sourceChannel,
    sensitivityLevel: doc.sensitivityLevel,
    uploadedAt: doc.uploadedAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    confirmedAt: doc.confirmedAt?.toISOString() ?? null,
    confirmedByUserId: doc.confirmedByUserId,
    clientId: doc.clientId,
    executionCaseId: doc.executionCaseId,
    intakeBundleId: doc.intakeBundleId,
    clientSummary,
    caseSummary,
    extraction,
    snapshotPromotion,
  })
}
