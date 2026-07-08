/**
 * Case Workspace read services — timeline, documents, opportunities, deadlines.
 */

import { findCaseById } from '../repositories/execution-case.ts'
import { queryTimelineEvents } from '../repositories/timeline-event.ts'
import { listDocumentsByCase } from '../repositories/document.ts'
import { listOpportunitiesByCase } from '../repositories/opportunity.ts'
import { listDeadlinesByCase } from '../repositories/deadline.ts'
import { listSentenceSnapshotsByCase } from '../repositories/sentence-snapshot.ts'
import {
  ok,
  validationError,
  notFoundError,
  fromRepositoryError,
} from './result.ts'
import {
  canViewCases,
  resolveMembershipRole,
  hasMinRole,
} from '../lib/permissions.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from './result.ts'
import type { TimelineEvent, SentenceSnapshot } from '@execflow/db/schema'
import type { Opportunity, Deadline } from '@execflow/db/schema'
import type { PaginatedResult } from '@execflow/db/repositories'

export type CaseDocumentsListItem = {
  id: string
  organizationId: string
  clientId: string | null
  executionCaseId: string | null
  documentClass: string | null
  sensitivityLevel: string
  fileName: string
  mimeType: string
  byteSize: number
  status: string
  ocrStatus: string
  sourceChannel: string
  uploadedAt: string
  uploadedByUserId: string
  confirmedAt: string | null
  confirmedByUserId: string | null
  updatedAt: string
}

export type PaginatedListResponse<T> = {
  items: T[]
  nextCursor: string | null
}

async function assertCaseInOrg(
  ctx: ReadContext,
  caseId: string
): Promise<ServiceResult<void>> {
  const found = await findCaseById(ctx.db, ctx.organizationId, caseId)
  if (!found.success) {
    if (found.error.code === 'NOT_FOUND') {
      return notFoundError('Execution case not found.')
    }
    return fromRepositoryError(found.error.code, found.error.message, found.error.cause)
  }
  return ok(undefined)
}

// Aceita MembershipRole completo; 'client' nunca chega aqui na prática —
// canViewCases exige no mínimo 'assistant' antes desta chamada.
function timelineVisibilityForRole(role: 'assistant' | 'lawyer' | 'admin' | 'client'): Array<
  'legal' | 'internal' | 'both'
> {
  if (hasMinRole(role, 'lawyer')) {
    return ['legal', 'internal', 'both']
  }
  return ['internal', 'both']
}

function toDocumentListItem(doc: {
  id: string
  organizationId: string
  clientId: string | null
  executionCaseId: string | null
  documentClass: string | null
  sensitivityLevel: string
  fileName: string
  mimeType: string
  byteSize: number
  status: string
  ocrStatus: string
  sourceChannel: string
  uploadedAt: Date
  uploadedByUserId: string
  confirmedAt: Date | null
  confirmedByUserId: string | null
  updatedAt: Date
}): CaseDocumentsListItem {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    clientId: doc.clientId,
    executionCaseId: doc.executionCaseId,
    documentClass: doc.documentClass,
    sensitivityLevel: doc.sensitivityLevel,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    byteSize: Number(doc.byteSize),
    status: doc.status,
    ocrStatus: doc.ocrStatus,
    sourceChannel: doc.sourceChannel,
    uploadedAt: doc.uploadedAt.toISOString(),
    uploadedByUserId: doc.uploadedByUserId,
    confirmedAt: doc.confirmedAt?.toISOString() ?? null,
    confirmedByUserId: doc.confirmedByUserId,
    updatedAt: doc.updatedAt.toISOString(),
  }
}

function toPaginatedResponse<T>(page: PaginatedResult<T>): PaginatedListResponse<T> {
  return {
    items: page.items,
    nextCursor: page.nextCursor,
  }
}

export async function listCaseTimeline(
  ctx: ReadContext,
  caseId: string,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedListResponse<TimelineEvent>>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view case timeline.')
  }

  const caseCheck = await assertCaseInOrg(ctx, caseId)
  if (!caseCheck.success) return caseCheck

  const result = await queryTimelineEvents(ctx.db, ctx.organizationId, caseId, {
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
    visibilityFilter: timelineVisibilityForRole(role),
    // A aba "Movimentações" é só pra movimentação de processo de verdade
    // (InfoSimples/DJEN/DataJud, ou lançamento manual a partir dos autos em
    // segredo de justiça) — nunca ruído de sistema (documento anexado,
    // monitoramento criado, etc.), que tem seção própria (Documentos).
    eventCategoryFilter: ['court'],
  })

  if (!result.success) {
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok(toPaginatedResponse(result.data))
}

export async function listCaseDocuments(
  ctx: ReadContext,
  caseId: string,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedListResponse<CaseDocumentsListItem>>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view case documents.')
  }

  const caseCheck = await assertCaseInOrg(ctx, caseId)
  if (!caseCheck.success) return caseCheck

  const result = await listDocumentsByCase(ctx.db, ctx.organizationId, caseId, {
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
  })

  if (!result.success) {
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok({
    items: result.data.items.map(toDocumentListItem),
    nextCursor: result.data.nextCursor,
  })
}

export async function listCaseOpportunities(
  ctx: ReadContext,
  caseId: string,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedListResponse<Opportunity>>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view case opportunities.')
  }

  const caseCheck = await assertCaseInOrg(ctx, caseId)
  if (!caseCheck.success) return caseCheck

  const result = await listOpportunitiesByCase(ctx.db, ctx.organizationId, caseId, {
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
  })

  if (!result.success) {
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok(toPaginatedResponse(result.data))
}

export async function listCaseDeadlines(
  ctx: ReadContext,
  caseId: string,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedListResponse<Deadline>>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view case deadlines.')
  }

  const caseCheck = await assertCaseInOrg(ctx, caseId)
  if (!caseCheck.success) return caseCheck

  const result = await listDeadlinesByCase(ctx.db, ctx.organizationId, caseId, {
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
  })

  if (!result.success) {
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok(toPaginatedResponse(result.data))
}

export async function listCaseSentenceSnapshots(
  ctx: ReadContext,
  caseId: string,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedListResponse<SentenceSnapshot>>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view case sentence snapshots.')
  }

  const caseCheck = await assertCaseInOrg(ctx, caseId)
  if (!caseCheck.success) return caseCheck

  const result = await listSentenceSnapshotsByCase(ctx.db, ctx.organizationId, caseId, {
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
  })

  if (!result.success) {
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok(toPaginatedResponse(result.data))
}
