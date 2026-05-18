/**
 * Document service — domain operations for the Document entity.
 *
 * KEY CONTRACTS:
 * 1. IMMUTABLE ORIGINAL: storageKey and checksumSha256 are NEVER changed after creation.
 *    The blob in storage is NEVER deleted. "Replacement" = new Document row with
 *    supersedes_document_id pointing to the old one.
 * 2. CHECKSUM VALIDATION HOOK: On registration, callers MUST provide the SHA-256 checksum
 *    of the actual file bytes. This service stores it; the upload endpoint should have
 *    already verified the checksum against the uploaded content.
 * 3. LEGAL SENSITIVITY: sensitivity_level controls read access. The storage layer
 *    (Phase 5+ blob access) uses this to enforce signed URL permissions.
 *
 * STATUS TRANSITIONS implemented in Phase 4:
 * - Register → 'pending_association' (initial)
 * - Associate → 'pending_extraction' (linked to case/client)
 * - Archive → 'archived' (operational deactivation, blob retained)
 *
 * STATUS TRANSITIONS deferred to Phase 5+:
 * - pending_extraction → extraction_running (OCR pipeline start)
 * - extraction_running → extraction_review (OCR complete)
 * - extraction_review → confirmed (human review)
 * - confirmed → superseded (replaced by newer version)
 *
 * Architecture ref: data-model-v1.md §2.6, execution-workflows.md §1.
 */

import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { insertDocument, associateDocument, updateDocumentStatus, findDocumentById } from '../repositories/document.ts'
import { incrementBundleFileCount } from '../repositories/intake-bundle.ts'
import { appendTimelineEvent } from '../repositories/timeline-event.ts'
import { writeAuditAndEvent } from './write-audit-event.ts'
import {
  ok,
  validationError,
  notFoundError,
  internalServiceError,
} from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import type { Document } from '@execflow/db/schema'
import type { IntakeSourceChannel, SensitivityLevel } from '@execflow/db/types'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type RegisterDocumentInput = {
  /**
   * Blob storage object key. IMMUTABLE after registration.
   * Format: "{org_id}/{year}/{month}/{uuid}.{ext}"
   * The blob must have been uploaded to storage BEFORE calling this service.
   */
  storageKey: string

  /**
   * SHA-256 hex checksum of the file bytes. IMMUTABLE after registration.
   * Computed at upload time. Used for: duplicate detection, tamper evidence.
   */
  checksumSha256: string

  /** MIME type of the file. IMMUTABLE. */
  mimeType: string

  /** Original filename as received from the upload source. IMMUTABLE. */
  fileName: string

  /** File size in bytes. IMMUTABLE. */
  byteSize: number

  /** How this document entered the system. */
  sourceChannel: IntakeSourceChannel

  /**
   * When the file was uploaded to blob storage.
   * Defaults to NOW() if not provided.
   */
  uploadedAt?: string | undefined

  // Optional associations (may be unknown at registration time)
  clientId?: string | undefined
  executionCaseId?: string | undefined

  /** The intake bundle this document belongs to. */
  intakeBundleId?: string | undefined

  /**
   * Document class from the legal vocabulary.
   * May be null at registration time (set during intake review).
   */
  documentClass?: string | undefined

  /** Legal sensitivity classification. Default: 'standard'. */
  sensitivityLevel?: SensitivityLevel | undefined

  /**
   * When this document supersedes a prior version.
   * Points to the prior Document.id (must exist and belong to same org).
   */
  supersedesDocumentId?: string | undefined

  /** For WhatsApp intake: forwarding phone number. LGPD sensitive. */
  whatsappForwardedFrom?: string | undefined
}

export type AssociateDocumentInput = {
  /** UUID of an existing client in this org. */
  clientId?: string | undefined

  /** UUID of an existing execution case in this org. */
  executionCaseId?: string | undefined

  /** Document class. May be set during association. */
  documentClass?: string | undefined
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

/**
 * Register a document (metadata only; blob must already be in storage).
 *
 * Validation:
 * - storageKey, checksumSha256, mimeType, fileName, byteSize are required
 * - checksumSha256 must be a 64-char hex string (SHA-256)
 *
 * Writes atomically: Document + AuditLog + DomainEvent.
 * If intakeBundleId is set, also increments bundle.file_count.
 */
export async function registerDocument(
  ctx: WriteContext,
  input: RegisterDocumentInput
): Promise<ServiceResult<Document>> {
  // -------------------------------------------------------------------------
  // 1. Domain validation
  // -------------------------------------------------------------------------

  if (!input.storageKey.trim()) {
    return validationError('Storage key is required.', 'storageKey')
  }
  if (!input.checksumSha256 || !/^[0-9a-f]{64}$/i.test(input.checksumSha256)) {
    return validationError(
      'checksumSha256 must be a valid 64-character SHA-256 hex string.',
      'checksumSha256'
    )
  }
  if (!input.mimeType.trim()) {
    return validationError('MIME type is required.', 'mimeType')
  }
  if (!input.fileName.trim()) {
    return validationError('File name is required.', 'fileName')
  }
  if (typeof input.byteSize !== 'number' || input.byteSize <= 0) {
    return validationError('File size must be a positive number.', 'byteSize')
  }

  let uploadedAt: Date
  if (input.uploadedAt) {
    uploadedAt = new Date(input.uploadedAt)
    if (isNaN(uploadedAt.getTime())) {
      return validationError('uploadedAt must be a valid ISO 8601 datetime.', 'uploadedAt')
    }
  } else {
    uploadedAt = new Date()
  }

  // Determine initial status based on available associations
  const hasAssociation = !!(input.clientId || input.executionCaseId)
  const initialStatus = hasAssociation ? 'pending_extraction' : 'pending_association'

  // -------------------------------------------------------------------------
  // 2. Transactional write
  // -------------------------------------------------------------------------

  try {
    const document = await withTx(ctx.db, async (tx) => {
      const now = new Date()

      const docResult = unwrapOrThrow(
        await insertDocument(tx, {
          organizationId: ctx.organizationId,
          clientId: input.clientId,
          executionCaseId: input.executionCaseId,
          intakeBundleId: input.intakeBundleId,
          documentClass: input.documentClass,
          storageKey: input.storageKey.trim(),
          checksumSha256: input.checksumSha256.toLowerCase(),
          mimeType: input.mimeType.trim(),
          fileName: input.fileName.trim(),
          byteSize: input.byteSize,
          status: initialStatus,
          sourceChannel: input.sourceChannel,
          ocrStatus: 'pending',
          sensitivityLevel: input.sensitivityLevel ?? 'standard',
          supersedesDocumentId: input.supersedesDocumentId,
          whatsappForwardedFrom: input.whatsappForwardedFrom,
          uploadedAt,
          uploadedByUserId: ctx.userId,
          createdAt: now,
          updatedAt: now,
        })
      )

      // If linked to an intake bundle, increment its file count
      if (input.intakeBundleId) {
        unwrapOrThrow(
          await incrementBundleFileCount(tx, ctx.organizationId, input.intakeBundleId)
        )
      }

      // If linked to a case, append a timeline event for the document arrival
      if (input.executionCaseId) {
        await appendTimelineEvent(tx, {
          organizationId: ctx.organizationId,
          executionCaseId: input.executionCaseId,
          eventType: 'document.registered',
          eventCategory: 'document',
          occurredAt: uploadedAt,
          summary: `Document registered: ${input.fileName.trim()}.`,
          payload: {
            documentId: docResult.id,
            fileName: input.fileName.trim(),
            documentClass: input.documentClass ?? null,
            sourceChannel: input.sourceChannel,
            status: initialStatus,
          },
          source: 'manual',
          actorType: 'user',
          actorId: ctx.actor.actorId,
          authorUserId: ctx.userId,
          visibility: 'internal',
        })
      }

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'created',
        entityType: 'Document',
        entityId: docResult.id,
        changes: {
          type: 'creation',
          snapshot: {
            status: initialStatus,
            fileName: input.fileName.trim(),
            mimeType: input.mimeType.trim(),
            byteSize: input.byteSize,
            sensitivityLevel: input.sensitivityLevel ?? 'standard',
          },
        },
        eventType: 'document.registered',
        aggregateType: 'Document',
        aggregateId: docResult.id,
        occurredAt: uploadedAt,
        eventPayload: {
          documentId: docResult.id,
          organizationId: ctx.organizationId,
          clientId: input.clientId ?? null,
          executionCaseId: input.executionCaseId ?? null,
          intakeBundleId: input.intakeBundleId ?? null,
          status: initialStatus,
          sourceChannel: input.sourceChannel,
          checksumSha256: input.checksumSha256.toLowerCase(),
          uploadedByUserId: ctx.userId,
        },
      })

      return docResult
    })

    return ok(document)
  } catch (err) {
    console.error('[document.service] registerDocument failed:', err)
    return internalServiceError('Failed to register document.', err)
  }
}

/**
 * Associate a document to a client and/or execution case.
 * Transitions status from 'pending_association' → 'pending_extraction'.
 * Legal sensitivity and storage metadata remain unchanged.
 */
export async function associateDocumentToCase(
  ctx: WriteContext,
  documentId: string,
  input: AssociateDocumentInput
): Promise<ServiceResult<Document>> {
  if (!input.clientId && !input.executionCaseId) {
    return validationError(
      'At least one of clientId or executionCaseId must be provided for association.',
    )
  }

  // Load the document to validate it belongs to this org
  const docResult = await findDocumentById(ctx.db, ctx.organizationId, documentId)
  if (!docResult.success) {
    return notFoundError('Document not found.')
  }

  const doc = docResult.data

  // Guard: only associate documents in pending_association status
  if (doc.status !== 'pending_association') {
    return validationError(
      `Document is in '${doc.status}' status and cannot be re-associated. Only 'pending_association' documents can be associated.`,
      'status'
    )
  }

  try {
    const updated = await withTx(ctx.db, async (tx) => {
      const now = new Date()

      const updateResult = unwrapOrThrow(
        await associateDocument(tx, ctx.organizationId, documentId, {
          ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
          ...(input.executionCaseId !== undefined ? { executionCaseId: input.executionCaseId } : {}),
          ...(input.documentClass !== undefined ? { documentClass: input.documentClass } : {}),
          status: 'pending_extraction',
          updatedAt: now,
        })
      )

      // Append a timeline event if now linked to a case
      if (input.executionCaseId) {
        await appendTimelineEvent(tx, {
          organizationId: ctx.organizationId,
          executionCaseId: input.executionCaseId,
          eventType: 'document.associated',
          eventCategory: 'document',
          occurredAt: now,
          summary: `Document associated: ${doc.fileName}.`,
          payload: {
            documentId,
            fileName: doc.fileName,
            documentClass: input.documentClass ?? doc.documentClass ?? null,
          },
          source: 'manual',
          actorType: 'user',
          actorId: ctx.actor.actorId,
          authorUserId: ctx.userId,
          visibility: 'internal',
        })
      }

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'status_changed',
        entityType: 'Document',
        entityId: documentId,
        changes: {
          type: 'state_transition',
          previous: doc.status,
          next: 'pending_extraction',
        },
        eventType: 'document.associated',
        aggregateType: 'Document',
        aggregateId: documentId,
        occurredAt: now,
        eventPayload: {
          documentId,
          organizationId: ctx.organizationId,
          clientId: input.clientId ?? null,
          executionCaseId: input.executionCaseId ?? null,
          documentClass:
            input.documentClass ?? doc.documentClass ?? null,
          previousStatus: doc.status,
          status: 'pending_extraction',
        },
      })

      return updateResult
    })

    return ok(updated)
  } catch (err) {
    console.error('[document.service] associateDocument failed:', err)
    return internalServiceError('Failed to associate document.', err)
  }
}

/**
 * Archive a document (operational deactivation; blob retained).
 * Valid transitions: pending_association | pending_extraction → archived.
 * Documents in 'confirmed' state require explicit lawyer authorization (Phase 5+).
 */
export async function archiveDocument(
  ctx: WriteContext,
  documentId: string
): Promise<ServiceResult<Document>> {
  const docResult = await findDocumentById(ctx.db, ctx.organizationId, documentId)
  if (!docResult.success) {
    return notFoundError('Document not found.')
  }

  const doc = docResult.data

  const archivableStatuses = ['pending_association', 'pending_extraction']
  if (!archivableStatuses.includes(doc.status)) {
    return validationError(
      `Document in '${doc.status}' status cannot be archived via this operation. Confirmed documents require lawyer authorization.`,
      'status'
    )
  }

  try {
    const updated = await withTx(ctx.db, async (tx) => {
      const now = new Date()

      const updateResult = unwrapOrThrow(
        await updateDocumentStatus(tx, ctx.organizationId, documentId, {
          status: 'archived',
          updatedAt: now,
        })
      )

      await writeAuditAndEvent({
        tx,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        action: 'archived',
        entityType: 'Document',
        entityId: documentId,
        changes: {
          type: 'state_transition',
          previous: doc.status,
          next: 'archived',
        },
        eventType: 'document.archived',
        aggregateType: 'Document',
        aggregateId: documentId,
        occurredAt: now,
        eventPayload: {
          documentId,
          organizationId: ctx.organizationId,
          previousStatus: doc.status,
          status: 'archived',
          archivedByUserId: ctx.userId,
        },
      })

      return updateResult
    })

    return ok(updated)
  } catch (err) {
    console.error('[document.service] archiveDocument failed:', err)
    return internalServiceError('Failed to archive document.', err)
  }
}
