/**
 * Domain-specific PostgreSQL enum types for EXECFLOW Phase 3.
 *
 * These enums model the operational vocabulary of *execução penal* practice.
 * Unlike infrastructure enums (_enums.ts), these represent legal and
 * operational states with domain semantics.
 *
 * ADDING ENUM VALUES: Use `ALTER TYPE ... ADD VALUE` in a forward-only migration.
 * REMOVING VALUES: Not possible without a full type replacement migration.
 * Removing a value that exists in any row will fail. Design enums broadly.
 *
 * Architecture ref: ARCHITECTURE_RULES.md §S-01 (explicit state machines),
 *                   data-model-v1.md §2 (entity lifecycle definitions).
 */

import { pgEnum } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Client account lifecycle.
 * Architecture ref: data-model-v1.md §2.1 lifecycle.
 *
 * active   → Client is under active representation.
 * inactive → No active executions; client retained for history.
 * merged   → Duplicate record merged into another client (pointer preserved).
 * archived → Closed file; retained for legal traceability.
 *
 * No hard-delete path: clients with any ExecutionCase, Document, or VisitNote
 * history are NEVER hard-deleted. data-model-v1.md §2.1.
 */
export const clientStatusEnum = pgEnum('client_status', [
  'active',
  'inactive',
  'merged',
  'archived',
])

// ---------------------------------------------------------------------------
// ExecutionCase
// ---------------------------------------------------------------------------

/**
 * ExecutionCase lifecycle states.
 * Architecture ref: data-model-v1.md §2.3, functional-architecture.md §4.1.
 *
 * intake     → Newly created; process number may be pending.
 * active     → Full operational tracking active; lawyer assigned.
 * suspended  → Temporarily halted (e.g., case transferred, pending transfer docs).
 * closed     → Matter concluded (sentence served, extinção, etc.).
 * archived   → Administrative archive; case closed, files retained.
 *
 * Transitions are validated at the service layer.
 * ARCHITECTURE_RULES.md §S-01: every status transition produces an AuditLog entry.
 */
export const caseStatusEnum = pgEnum('case_status', [
  'intake',
  'active',
  'suspended',
  'closed',
  'archived',
])

/**
 * ExecutionCase type classification.
 * Architecture ref: data-model-v1.md §2.3, execution-workflows.md §2.
 *
 * primary  → Main *execução penal* process.
 * apenso   → Apenso/incidente linked to a primary case.
 * incident → Procedural incident (PAD, incidente de execução).
 * parallel → Linked execution from a concurrent conviction.
 */
export const caseKindEnum = pgEnum('case_kind', [
  'primary',
  'apenso',
  'incident',
  'parallel',
])

// ---------------------------------------------------------------------------
// Regime (custody)
// ---------------------------------------------------------------------------

/**
 * Penal execution regime types per Brazilian LEP.
 * Architecture ref: execution-engine.md §2 (temporal events affecting regime),
 *                   data-model-v1.md §3.1 (ExecutionCustodySnapshot).
 *
 * fechado    → Closed prison regime (regime fechado).
 * semiaberto → Semi-open regime (regime semiaberto).
 * aberto     → Open regime (regime aberto).
 * albergue   → House-arrest / albergue domiciliar.
 * domiciliar → Domiciliary arrest (prisão domiciliar).
 * provisorio → Preventive/provisional detention (prisão provisória / detração).
 * unknown    → Regime not yet confirmed from documents.
 *
 * Legal note: these map to LEP Art. 33 classifications plus operational variants.
 * The engine uses playbook versions to interpret legal consequences of each.
 * Architecture ref: playbook-system.md §3 (rule categories).
 */
export const regimeTypeEnum = pgEnum('regime_type', [
  'fechado',
  'semiaberto',
  'aberto',
  'albergue',
  'domiciliar',
  'provisorio',
  'unknown',
])

// ---------------------------------------------------------------------------
// SentenceSnapshot
// ---------------------------------------------------------------------------

/**
 * SentenceSnapshot review lifecycle.
 * Architecture ref: data-model-v1.md §3.2, execution-engine.md §1.
 *
 * proposed   → Calculated by engine or assistant; pending lawyer review.
 * confirmed  → Lawyer has reviewed and confirmed the arithmetic.
 * superseded → A newer snapshot has replaced this one; row remains for history.
 *
 * Only 'confirmed' snapshots are used as engine inputs.
 * ARCHITECTURE_RULES.md §D-03: no unconfirmed data as engine input.
 */
export const snapshotStatusEnum = pgEnum('snapshot_status', [
  'proposed',
  'confirmed',
  'superseded',
  'rejected',
])

/**
 * Confidence levels for calculated or extracted values.
 * Architecture ref: execution-engine.md §5 (legal uncertainty model),
 *                   AI_BOUNDARIES.md (confidence handling).
 *
 * high    → All source documents present and consistent; calculation unambiguous.
 * medium  → Most sources present; minor assumptions made; requires review.
 * low     → Significant missing data or conflicting sources; requires investigation.
 * unknown → Calculation not yet attempted or sources unavailable.
 */
export const confidenceLevelEnum = pgEnum('confidence_level', [
  'high',
  'medium',
  'low',
  'unknown',
])

// ---------------------------------------------------------------------------
// IntakeBundle
// ---------------------------------------------------------------------------

/**
 * Intake bundle processing lifecycle.
 * Architecture ref: execution-workflows.md §1.2 (intake state machine).
 *
 * received          → Files stored; OCR not yet started.
 * extraction_pending → OCR/parse queued or running.
 * extraction_review  → OCR completed; assistant reviewing proposed fields.
 * association_review → Fields reviewed; lawyer associating to client/case.
 * execution_active   → Bundle fully processed and linked to a case.
 * failed_ocr         → OCR pipeline failed; needs manual review.
 * rejected           → Document determined to be irrelevant or duplicate.
 */
export const intakeBundleStatusEnum = pgEnum('intake_bundle_status', [
  'received',
  'extraction_pending',
  'extraction_review',
  'association_review',
  'execution_active',
  'failed_ocr',
  'rejected',
])

/**
 * Intake source channel.
 * Architecture ref: execution-workflows.md §1.1 (intake channels).
 * Data retained for operational analytics and compliance audits.
 */
export const intakeSourceChannelEnum = pgEnum('intake_source_channel', [
  'intake_manual',
  'intake_pdf',
  'intake_scan',
  'intake_whatsapp',
  'intake_email',
  'intake_api',
  'intake_tribunal',
])

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Document processing lifecycle.
 * Architecture ref: data-model-v1.md §2.6, functional-architecture.md §4.2.
 *
 * pending_association → Uploaded; not yet linked to client/case.
 * pending_extraction  → Linked; OCR not yet started.
 * extraction_running  → OCR/parse pipeline running.
 * extraction_review   → OCR complete; proposed fields awaiting assistant review.
 * confirmed           → Lawyer/assistant confirmed document associations and content.
 * archived            → Document retained but no longer operationally active.
 * superseded          → Replaced by a newer version (supersedes_document_id set).
 */
export const documentStatusEnum = pgEnum('document_status', [
  'pending_association',
  'pending_extraction',
  'extraction_running',
  'extraction_review',
  'confirmed',
  'archived',
  'superseded',
  'rejected',
])

/**
 * OCR/extraction processing status.
 * Separate from document_status to allow independent tracking of
 * OCR pipeline state without changing the document's overall status.
 * Architecture ref: execution-workflows.md §1.1 (OCR extraction step).
 */
export const ocrStatusEnum = pgEnum('ocr_status', [
  'not_applicable',
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
])

/**
 * Document legal sensitivity classification.
 * Architecture ref: ENGINEERING_PRINCIPLES.md §5 (auditability),
 *                   data-model-v1.md §8 (security and compliance — LGPD).
 *
 * public     → No access restrictions (informational content).
 * standard   → Normal operational access (any org member).
 * sensitive  → LGPD-sensitive (CPF, health info, family data) — lawyer/admin only.
 * restricted → Maximum restriction (legal strategy, privileged communication).
 */
export const sensitivityLevelEnum = pgEnum('sensitivity_level', [
  'public',
  'standard',
  'sensitive',
  'restricted',
])

// ---------------------------------------------------------------------------
// TimelineEvent
// ---------------------------------------------------------------------------

/**
 * Broad categorization of timeline events.
 * Architecture ref: execution-workflows.md §3.2 (timeline event types).
 *
 * court       → Court decisions, hearings, despachos, mandados.
 * prison      → Transfer, discipline, work/study, visit events.
 * sentence    → Progressão, regressão, recálculo, unificação, extinção.
 * benefit     → Remição, detração, indulto, comutação, livramento.
 * legal_action→ Petições filed, requerimentos, HCs, incidentes.
 * document    → Document uploaded, confirmed, associated.
 * ai          → AI-generated analysis, suggestion, or classification.
 * internal    → Office notes, task creation, internal coordination.
 * system      → Automated system-generated events (outbox, worker).
 *
 * event_type (text) carries the fine-grained namespaced identifier
 * (e.g., 'court.hearing', 'discipline.falta_grave', 'sentence.progressao').
 * This category provides the high-level filter axis for timeline queries.
 */
export const timelineEventCategoryEnum = pgEnum('timeline_event_category', [
  'court',
  'prison',
  'sentence',
  'benefit',
  'legal_action',
  'document',
  'ai',
  'internal',
  'system',
])

/**
 * Source of the timeline event — how it originated.
 * Architecture ref: data-model-v1.md §2.5, execution-workflows.md §3.1.
 */
export const timelineEventSourceEnum = pgEnum('timeline_event_source', [
  'manual',
  'document',
  'integration',
  'ai_suggestion',
  'system_rule',
])

/**
 * Visibility of a timeline event.
 * Architecture ref: data-model-v1.md §2.5.
 *
 * legal    → Visible in legal output (court-facing narrative).
 * internal → Office-only (strategy notes, internal flags).
 * both     → Visible in both contexts.
 */
export const timelineVisibilityEnum = pgEnum('timeline_visibility', [
  'legal',
  'internal',
  'both',
])
