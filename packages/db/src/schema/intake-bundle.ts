/**
 * IntakeBundle — logical grouping of files received in one intake event.
 *
 * An intake bundle is created whenever the system receives documents for
 * processing — whether from manual upload, PDF batch, WhatsApp, or future
 * integrations. It tracks:
 * 1. The origin and receipt of documents.
 * 2. OCR/extraction pipeline progress.
 * 3. The association workflow (linking to client + case).
 *
 * RELATIONSHIP TO DOCUMENTS:
 * An IntakeBundle aggregates multiple Document rows. Documents reference
 * the bundle via intake_bundle_id. The bundle does NOT hold file bytes —
 * those are in the Document → blob storage.
 *
 * INCOMPLETE INTAKE SUPPORT:
 * Bundles may exist in 'received' state with NO documents yet (files still uploading).
 * The missing_fields JSON tracks what information is required to complete intake.
 * This supports the recovery workflow: come back to a partial intake.
 * Architecture ref: execution-workflows.md §1.3 (missing-data handling).
 *
 * OCR COMPATIBILITY:
 * The extraction pipeline reads documents linked to this bundle.
 * Bundle status reflects the aggregate pipeline state across all docs.
 * Architecture ref: execution-workflows.md §1 (intake state machine).
 *
 * ASSOCIATION WORKFLOW:
 * After OCR review, the bundle is associated to a client and/or case.
 * proposed_* fields hold system suggestions (from OCR/AI).
 * associated_* fields hold human-confirmed associations.
 * The distinction is critical for audit and ARCHITECTURE_RULES §D-03.
 *
 * IMMUTABILITY:
 * id, organization_id, source_channel, received_at, created_by_user_id are immutable.
 * Status transitions are mutable (with AuditLog entries at service layer).
 * Files in the bundle (via Document) are immutable once uploaded.
 *
 * Architecture ref: data-model-v1.md §3.5, execution-workflows.md §1.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { clients } from './client.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import { intakeBundleStatusEnum, intakeSourceChannelEnum } from './_enums-domain.ts'

export const intakeBundles = pgTable(
  'intake_bundles',
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
    // Source and receipt (immutable)
    // -------------------------------------------------------------------------

    /**
     * How this bundle entered the system.
     * Architecture ref: execution-workflows.md §1.1 (intake channels).
     * Immutable — source channel does not change after creation.
     */
    sourceChannel: intakeSourceChannelEnum('source_channel').notNull(),

    /**
     * When the bundle was received / created.
     * LEGAL TIME context: this is the operational receipt timestamp.
     * For file uploads, this is the moment files arrived. For WhatsApp
     * forwards, this is the connector receipt time, not the send time.
     * Immutable. Distinct from created_at (which is the DB row timestamp).
     */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),

    /**
     * The user who created or received this bundle.
     * For manual: the assistant/lawyer who started the intake.
     * For automated channels: the system user ID or integration account.
     * Immutable.
     */
    uploaderUserId: uuid('uploader_user_id')
      .notNull()
      .references(() => users.id),

    // -------------------------------------------------------------------------
    // Processing state
    // -------------------------------------------------------------------------

    /**
     * Current processing status of this bundle.
     * State machine: received → extraction_pending → extraction_review
     *   → association_review → execution_active
     *   (branches: failed_ocr, rejected)
     * Architecture ref: execution-workflows.md §1.2.
     */
    status: intakeBundleStatusEnum('status').notNull().default('received'),

    // -------------------------------------------------------------------------
    // Association proposals (AI/OCR suggested — not human-confirmed)
    // -------------------------------------------------------------------------

    /**
     * Client that the OCR/AI pipeline suggests this bundle belongs to.
     * NOT authoritative — proposed by extraction pipeline.
     * Requires human confirmation before use.
     * ARCHITECTURE_RULES.md §D-03: AI suggestions never silently applied.
     */
    proposedClientId: uuid('proposed_client_id').references(() => clients.id),

    /**
     * Execution case that the OCR/AI pipeline suggests this bundle belongs to.
     * NOT authoritative. Requires human confirmation.
     */
    proposedExecutionCaseId: uuid('proposed_execution_case_id').references(
      () => executionCases.id
    ),

    // -------------------------------------------------------------------------
    // Human-confirmed association
    // -------------------------------------------------------------------------

    /**
     * Client confirmed by a human review.
     * Set when a lawyer/assistant completes the association_review step.
     */
    associatedClientId: uuid('associated_client_id').references(() => clients.id),

    /**
     * Execution case confirmed by a human review.
     * May be NULL if bundle creates a NEW case (not yet created at confirmation time).
     */
    associatedExecutionCaseId: uuid('associated_execution_case_id').references(
      () => executionCases.id
    ),

    /**
     * When the human association was confirmed.
     */
    associatedAt: timestamp('associated_at', { withTimezone: true }),

    /**
     * Who performed the human association confirmation.
     */
    associatedByUserId: uuid('associated_by_user_id').references(() => users.id),

    // -------------------------------------------------------------------------
    // File count tracking
    // -------------------------------------------------------------------------

    /**
     * Count of Document rows linked to this bundle.
     * Maintained at service layer on document association.
     * Useful for quick sanity checks without COUNT(*) joins.
     */
    fileCount: integer('file_count').notNull().default(0),

    // -------------------------------------------------------------------------
    // Missing data tracking (recovery workflow)
    // -------------------------------------------------------------------------

    /**
     * List of required fields that are absent or uncertain.
     * Format: [{ field: 'cpf', reason: 'not found in documents', required: true }]
     * Drives the human review interface: "these fields must be completed before activation."
     * Cleared as fields are confirmed. NULL when no missing data known.
     * Architecture ref: execution-workflows.md §1.3 (missing-data handling).
     */
    missingFields: jsonb('missing_fields'),

    // -------------------------------------------------------------------------
    // Notes
    // -------------------------------------------------------------------------

    /** Free-text operational notes about this intake. */
    notes: text('notes'),

    // -------------------------------------------------------------------------
    // Timestamps
    // -------------------------------------------------------------------------

    /** When this record was created in the database. Immutable. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Last time any mutable field was updated. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Queue pattern: bundles by status within org.
     * Primary index for the intake review queue.
     * data-model-v1.md: "queue-first navigation."
     */
    index('intake_bundles_org_status_idx').on(table.organizationId, table.status),

    /** Bundles uploaded by a user (workload view). */
    index('intake_bundles_uploader_idx').on(table.organizationId, table.uploaderUserId),

    /** Bundles associated to a client (traceability). */
    index('intake_bundles_client_idx').on(table.associatedClientId),

    /** Bundles associated to a case. */
    index('intake_bundles_case_idx').on(table.associatedExecutionCaseId),

    /** Received-at ordering for SLA monitoring. */
    index('intake_bundles_received_idx').on(table.organizationId, table.receivedAt),
  ]
)

export type IntakeBundle = typeof intakeBundles.$inferSelect
export type NewIntakeBundle = typeof intakeBundles.$inferInsert
