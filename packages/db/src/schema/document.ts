/**
 * Document — an immutable stored file with lifecycle metadata.
 *
 * A Document represents a file (PDF, image, exported bundle) that enters
 * the EXECFLOW system. The file's binary content is stored in blob storage
 * (e.g., Cloudflare R2) and referenced by storage_key.
 *
 * IMMUTABILITY CONTRACT:
 * The following fields are immutable after the row is created:
 * - id
 * - organization_id
 * - storage_key      ← blob storage path NEVER reused or overwritten
 * - checksum_sha256  ← computed at upload time, never changed
 * - mime_type
 * - file_name
 * - byte_size
 * - uploaded_at
 * - uploaded_by_user_id
 *
 * If a document is "replaced" (e.g., a corrected scan), a NEW document row
 * is created and supersedes_document_id points to the prior version.
 * The prior document row and its blob are NEVER deleted.
 * Architecture ref: data-model-v1.md §2.6, ARCHITECTURE_RULES.md §D-01.
 *
 * SOFT-DELETE SEMANTICS:
 * deleted_at is allowed ONLY for documents that have never been 'confirmed'
 * (e.g., mistakenly uploaded duplicate before association). Once confirmed,
 * use status='archived' or status='superseded' instead.
 * The blob in storage is NEVER deleted even when the row is soft-deleted.
 * Architecture ref: data-model-v1.md §2.6.
 *
 * PROVENANCE:
 * source_channel records how the file entered the system.
 * intake_bundle_id groups files from the same intake event.
 * whatsapp_forwarded_from preserves informal provenance chains.
 *
 * OCR STATUS:
 * ocr_status tracks the extraction pipeline independently from the
 * document's overall lifecycle status. A document can be 'confirmed' but
 * still have 'pending' extraction (e.g., extraction not yet requested).
 *
 * SENSITIVITY CLASSIFICATION:
 * sensitivity_level classifies the document for access control.
 * 'restricted' documents (legal strategy, privileged comms) require
 * lawyer/admin role. Reads of restricted documents are logged in AuditLog.
 *
 * Architecture ref: data-model-v1.md §2.6, execution-workflows.md §1,
 *                   functional-architecture.md §4.2.
 */

import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { clients } from './client.ts'
import { executionCases } from './execution-case.ts'
import { intakeBundles } from './intake-bundle.ts'
import { users } from './user.ts'
import {
  documentStatusEnum,
  ocrStatusEnum,
  sensitivityLevelEnum,
  intakeSourceChannelEnum,
} from './_enums-domain.ts'

export const documents = pgTable(
  'documents',
  {
    // -------------------------------------------------------------------------
    // Identity (immutable after creation)
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Tenant isolation. Immutable.
     * Architecture ref: ARCHITECTURE_RULES.md §M-01.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Associations (mutable — set during intake review)
    // -------------------------------------------------------------------------

    /**
     * Client this document belongs to.
     * May be NULL at upload time (association happens during intake review).
     * Set via the intake association workflow.
     */
    clientId: uuid('client_id').references(() => clients.id),

    /**
     * Execution case this document belongs to.
     * May be NULL if the document is only client-level (no case yet).
     */
    executionCaseId: uuid('execution_case_id').references(() => executionCases.id),

    /**
     * The intake bundle this document came from.
     * NULL only for documents created outside normal intake (e.g., system-generated exports).
     */
    intakeBundleId: uuid('intake_bundle_id').references(() => intakeBundles.id),

    // -------------------------------------------------------------------------
    // Document classification (mutable — refined during review)
    // -------------------------------------------------------------------------

    /**
     * Semantic document class from the legal domain vocabulary.
     * Free text (not enum) because document classes evolve with legal practice
     * and we must not require migrations for new document types.
     *
     * Common values: 'sentenca', 'acórdão', 'despacho', 'certidao_carceraria',
     *   'guia_de_execucao', 'laudo_disciplinar', 'comprovante_trabalho_estudo',
     *   'mandado_prisao', 'alvara_soltura', 'hc_decisao', 'atestado_medico',
     *   'documento_pessoal', 'procuracao', 'outros'
     *
     * NULL while the document class has not been determined.
     */
    documentClass: text('document_class'),

    // -------------------------------------------------------------------------
    // Storage (immutable after creation)
    // -------------------------------------------------------------------------

    /**
     * Object key in blob storage (e.g., Cloudflare R2 object key).
     * Format: "{org_id}/{year}/{month}/{uuid}.{ext}"
     * IMMUTABLE: this path is never reused. Binary content is never overwritten.
     * Architecture ref: ENGINEERING_PRINCIPLES.md §2 (no silent mutations).
     */
    storageKey: text('storage_key').notNull(),

    /**
     * SHA-256 hex checksum of the file bytes, computed at upload time.
     * IMMUTABLE. Used for: duplicate detection, tamper evidence, replay verification.
     * data-model-v1.md §2.6: "checksum_sha256 immutable."
     */
    checksumSha256: text('checksum_sha256').notNull(),

    /**
     * MIME type of the file. Immutable.
     * Example: 'application/pdf', 'image/jpeg', 'image/png'
     */
    mimeType: text('mime_type').notNull(),

    /**
     * Original filename as received from the upload source. Immutable.
     * Used for display and document class inference.
     */
    fileName: text('file_name').notNull(),

    /**
     * File size in bytes. Immutable. Bigint for future-proofing (large bundles).
     * mode: 'number' returns a JavaScript number; safe for files under 9 petabytes.
     */
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),

    // -------------------------------------------------------------------------
    // Lifecycle status
    // -------------------------------------------------------------------------

    /**
     * Document lifecycle state.
     * pending_association → ... → confirmed → archived | superseded
     * Architecture ref: data-model-v1.md §2.6.
     */
    status: documentStatusEnum('status').notNull().default('pending_association'),

    /**
     * How this document entered the system.
     * Matches the source_channel vocabulary used in IntakeBundle.
     */
    sourceChannel: intakeSourceChannelEnum('source_channel').notNull(),

    // -------------------------------------------------------------------------
    // OCR / extraction state (independent of lifecycle status)
    // -------------------------------------------------------------------------

    /**
     * OCR/extraction pipeline status for this document.
     * Tracked independently from status because extraction can fail
     * without affecting the document's association or confirmation status.
     * not_applicable: binary not suitable for OCR (already structured data).
     * Architecture ref: execution-workflows.md §1.1 (OCR extraction step).
     */
    ocrStatus: ocrStatusEnum('ocr_status').notNull().default('pending'),

    // -------------------------------------------------------------------------
    // Sensitivity classification
    // -------------------------------------------------------------------------

    /**
     * Legal sensitivity classification.
     * Controls: who can read this document, whether reads are logged.
     * Architecture ref: ENGINEERING_PRINCIPLES.md §5 (LGPD / privilege).
     */
    sensitivityLevel: sensitivityLevelEnum('sensitivity_level')
      .notNull()
      .default('standard'),

    // -------------------------------------------------------------------------
    // Version chain
    // -------------------------------------------------------------------------

    /**
     * When this document supersedes a prior version.
     * Example: a corrected scan replaces an illegible original.
     * The superseded document remains in the database; this field
     * creates an explicit version chain.
     * NULL for original (first version) documents.
     */
    supersedesDocumentId: uuid('supersedes_document_id').references(
      (): AnyPgColumn => documents.id
    ),

    // -------------------------------------------------------------------------
    // Informal provenance
    // -------------------------------------------------------------------------

    /**
     * For WhatsApp intake: phone number or identifier of the forwarder.
     * Retains the informal chain of custody for evidence purposes.
     * LGPD: treated as sensitive contact data.
     */
    whatsappForwardedFrom: text('whatsapp_forwarded_from'),

    // -------------------------------------------------------------------------
    // Confirmation
    // -------------------------------------------------------------------------

    /**
     * When a lawyer/assistant confirmed this document's associations and class.
     * NULL until confirmation. Immutable once set (to change: new audit entry).
     */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    /**
     * Who confirmed this document.
     * NULL until confirmed.
     */
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id),

    // -------------------------------------------------------------------------
    // Timestamps
    // -------------------------------------------------------------------------

    /**
     * When the file was uploaded to blob storage.
     * IMMUTABLE. This is the true "file arrival" time.
     * distinct from created_at to support: "uploaded before you created the bundle" scenarios.
     */
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),

    /**
     * Who uploaded this document. Immutable.
     */
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id),

    /** Last time any mutable metadata field was updated. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /** When this record was created in the database. Immutable. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete timestamp.
     * ONLY allowed before confirmation. Use status='archived' for confirmed docs.
     * Blob content is NEVER deleted even after soft-delete.
     * Architecture ref: data-model-v1.md §2.6.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    /**
     * OCR PROCESSING QUEUE: documents pending extraction.
     * pattern: WHERE ocr_status = 'pending' AND deleted_at IS NULL
     * Partial-index semantics achieved via query filter; full index covers all statuses.
     */
    index('documents_ocr_queue_idx').on(table.organizationId, table.ocrStatus),

    /** Documents by case (primary operational lookup). */
    index('documents_case_status_idx').on(table.executionCaseId, table.status),

    /** Documents by bundle. */
    index('documents_bundle_idx').on(table.intakeBundleId),

    /**
     * Duplicate detection: find documents with same content regardless of name/source.
     * A matching checksum does not mean the document is a duplicate of the same
     * LEGAL document — the same file can be legitimately linked to multiple cases.
     * This index enables fast duplicate detection queries.
     */
    index('documents_checksum_idx').on(table.checksumSha256),

    /** Documents by client. */
    index('documents_client_idx').on(table.organizationId, table.clientId),

    /** Org-level document queue by status. */
    index('documents_org_status_idx').on(table.organizationId, table.status),
  ]
)

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
