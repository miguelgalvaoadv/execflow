/**
 * Document repository — data access layer for the documents table.
 *
 * KEY IMMUTABILITY CONTRACT:
 * The following fields are immutable after creation and must NEVER be updated:
 * storageKey, checksumSha256, mimeType, fileName, byteSize, uploadedAt, uploadedByUserId.
 * Any update method here MUST NOT touch these fields.
 * Architecture ref: data-model-v1.md §2.6.
 *
 * STATUS TRANSITIONS (the only mutable aspect of a document):
 * pending_association → pending_extraction → extraction_running → extraction_review
 *   → confirmed → archived | superseded
 *
 * Phase 4 implements: pending_association → confirmed | archived transitions.
 * OCR-pipeline transitions (extraction_*) are Phase 5+.
 */

import { eq, and, isNull, desc, sql, or, lt, ilike } from 'drizzle-orm'
import { documents, executionCases } from '@execflow/db/schema'
import type { Document, NewDocument } from '@execflow/db/schema'
import type { DocumentStatus } from '@execflow/db/types'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams, PaginatedResult } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Find a document by primary key, scoped to the organization.
 * Soft-deleted documents are excluded (deletedAt IS NULL).
 */
export async function findDocumentById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<Document>> {
  try {
    const row = await db.query.documents.findFirst({
      where: and(
        eq(documents.id, id),
        eq(documents.organizationId, organizationId),
        isNull(documents.deletedAt)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query document.', cause: err },
    }
  }
}

/**
 * List documents associated with an execution case, newest first.
 * Excludes soft-deleted rows. Paginated by uploaded_at + id cursor.
 */
export async function listDocumentsByCase(
  db: AnyTx,
  organizationId: string,
  executionCaseId: string,
  params: PaginationParams
): Promise<RepositoryResult<PaginatedResult<Document>>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)

    const conditions = [
      eq(documents.organizationId, organizationId),
      eq(documents.executionCaseId, executionCaseId),
      isNull(documents.deletedAt),
    ]

    if (params.cursor !== undefined) {
      const [cursorUploadedAt, cursorId] = params.cursor.split('|')
      if (cursorUploadedAt !== undefined && cursorId !== undefined) {
        conditions.push(
          sql`(${documents.uploadedAt}, ${documents.id}) < (${cursorUploadedAt}::timestamptz, ${cursorId}::uuid)`
        )
      }
    }

    const rows = await db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.uploadedAt), desc(documents.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items[items.length - 1]
    const nextCursor =
      hasMore && last !== undefined
        ? `${last.uploadedAt.toISOString()}|${last.id}`
        : null

    return {
      success: true,
      data: { items, nextCursor, totalCount: items.length },
    }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list documents for case.', cause: err },
    }
  }
}

export type DocumentOrgListItem = {
  id: string
  fileName: string
  documentClass: string | null
  status: string
  ocrStatus: string
  uploadedAt: Date
  executionCaseId: string | null
  caseInternalRef: string | null
}

export type ListDocumentsForOrgFilters = {
  status?: string
  documentClass?: string
  q?: string
}

function parseOrgListCursor(cursor: string): { uploadedAt: Date; id: string } | null {
  const separator = cursor.lastIndexOf(':')
  if (separator <= 0) return null
  const uploadedAtRaw = cursor.slice(0, separator)
  const id = cursor.slice(separator + 1)
  const uploadedAt = new Date(uploadedAtRaw)
  if (Number.isNaN(uploadedAt.getTime()) || id === '') return null
  return { uploadedAt, id }
}

function encodeOrgListCursor(uploadedAt: Date, id: string): string {
  return `${uploadedAt.toISOString()}:${id}`
}

/**
 * Paginated org-scoped document list — uploadedAt DESC, id DESC.
 * LEFT JOIN execution_cases for case internal ref.
 */
export async function listDocumentsForOrg(
  db: AnyTx,
  organizationId: string,
  filters: ListDocumentsForOrgFilters,
  params: PaginationParams
): Promise<RepositoryResult<{ items: DocumentOrgListItem[]; nextCursor: string | null }>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)
    const conditions = [
      eq(documents.organizationId, organizationId),
      isNull(documents.deletedAt),
    ]

    if (filters.status !== undefined) {
      conditions.push(eq(documents.status, filters.status as Document['status']))
    }

    if (filters.documentClass !== undefined) {
      conditions.push(eq(documents.documentClass, filters.documentClass))
    }

    const q = filters.q?.trim()
    if (q !== undefined && q.length > 0) {
      const pattern = `%${q}%`
      conditions.push(
        or(
          ilike(documents.fileName, pattern),
          ilike(documents.documentClass, pattern),
          ilike(executionCases.internalRef, pattern)
        )!
      )
    }

    if (params.cursor !== undefined) {
      const parsed = parseOrgListCursor(params.cursor)
      if (parsed === null) {
        return {
          success: false,
          error: { code: 'CONSTRAINT', message: 'Invalid pagination cursor.' },
        }
      }
      conditions.push(
        or(
          lt(documents.uploadedAt, parsed.uploadedAt),
          and(eq(documents.uploadedAt, parsed.uploadedAt), lt(documents.id, parsed.id))
        )!
      )
    }

    const rows = await db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        documentClass: documents.documentClass,
        status: documents.status,
        ocrStatus: documents.ocrStatus,
        uploadedAt: documents.uploadedAt,
        executionCaseId: documents.executionCaseId,
        caseInternalRef: executionCases.internalRef,
      })
      .from(documents)
      .leftJoin(
        executionCases,
        and(
          eq(documents.executionCaseId, executionCases.id),
          eq(executionCases.organizationId, organizationId),
          isNull(executionCases.deletedAt)
        )
      )
      .where(and(...conditions))
      .orderBy(desc(documents.uploadedAt), desc(documents.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const items: DocumentOrgListItem[] = page.map((row: any) => ({
      id: row.id,
      fileName: row.fileName,
      documentClass: row.documentClass,
      status: row.status,
      ocrStatus: row.ocrStatus,
      uploadedAt: row.uploadedAt,
      executionCaseId: row.executionCaseId,
      caseInternalRef: row.caseInternalRef,
    }))

    const nextCursor =
      hasMore && page.length > 0
        ? encodeOrgListCursor(page[page.length - 1]!.uploadedAt, page[page.length - 1]!.id)
        : null

    return { success: true, data: { items, nextCursor } }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list documents for organization.', cause: err },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert a new document record.
 * Must be called inside a transaction.
 * Immutable fields (storageKey, checksum, etc.) are set at insert; never updated.
 */
export async function insertDocument(
  tx: DbTransaction,
  data: NewDocument
): Promise<RepositoryResult<Document>> {
  try {
    const [row] = await tx.insert(documents).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Document insert returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert document.', cause: err },
    }
  }
}

/**
 * Associate a document to a client and/or execution case.
 * Only transitions status if currently 'pending_association'.
 * Immutable fields are excluded from the update.
 */
export async function associateDocument(
  tx: DbTransaction,
  organizationId: string,
  documentId: string,
  params: {
    clientId?: string
    executionCaseId?: string
    intakeBundleId?: string
    documentClass?: string
    status: DocumentStatus
    updatedAt: Date
  }
): Promise<RepositoryResult<Document>> {
  try {
    const [row] = await tx
      .update(documents)
      .set({
        clientId: params.clientId,
        executionCaseId: params.executionCaseId,
        intakeBundleId: params.intakeBundleId,
        documentClass: params.documentClass,
        status: params.status,
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          isNull(documents.deletedAt)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to associate document.', cause: err },
    }
  }
}

/**
 * Transition document status.
 * Guards against updating immutable fields.
 * Confirmation sets confirmed_at and confirmed_by_user_id.
 */
export async function updateDocumentStatus(
  tx: DbTransaction,
  organizationId: string,
  documentId: string,
  params: {
    status: DocumentStatus
    confirmedByUserId?: string
    confirmedAt?: Date
    updatedAt: Date
  }
): Promise<RepositoryResult<Document>> {
  try {
    const [row] = await tx
      .update(documents)
      .set({
        status: params.status,
        confirmedByUserId: params.confirmedByUserId,
        confirmedAt: params.confirmedAt,
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          isNull(documents.deletedAt)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update document status.', cause: err },
    }
  }
}
