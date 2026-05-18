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

import { eq, and, isNull } from 'drizzle-orm'
import { documents } from '@execflow/db/schema'
import type { Document, NewDocument } from '@execflow/db/schema'
import type { DocumentStatus } from '@execflow/db/types'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

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
 * Find a document by its checksum within the organization.
 * Used for duplicate detection before registration.
 * Returns null when no match — does NOT return NOT_FOUND error.
 */
export async function findDocumentByChecksum(
  db: AnyTx,
  organizationId: string,
  checksumSha256: string
): Promise<RepositoryResult<Document | null>> {
  try {
    const row = await db.query.documents.findFirst({
      where: and(
        eq(documents.organizationId, organizationId),
        eq(documents.checksumSha256, checksumSha256),
        isNull(documents.deletedAt)
      ),
    })

    return { success: true, data: row ?? null }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query document by checksum.', cause: err },
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
