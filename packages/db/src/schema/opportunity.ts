/**
 * Opportunity — a detected procedural advantage window for an execution case.
 *
 * Opportunities are HYPOTHESES of procedural advantage, not guaranteed outcomes.
 * The system surfaces them; a lawyer QUALIFIES them before any piece is drafted.
 *
 * TYPES: progression, remission, detraction, amnesty, commutation, hc,
 *        pad_challenge, prescription, recalculation, excess_execution,
 *        rights_violation, manual.
 *
 * STATE MACHINE (strict):
 *   suggested → qualified → pursuing → realized    (terminal)
 *   suggested → dismissed                          (terminal)
 *   qualified → dismissed                          (terminal)
 *   pursuing  → dismissed                          (terminal, rare but allowed)
 *   [suggested|qualified|pursuing] → expired       (terminal, window closed)
 *
 *   FORBIDDEN: any transition FROM realized, dismissed, expired.
 *
 * HUMAN GATE (non-negotiable):
 *   EVERY status transition requires an OpportunityReview row.
 *   The review record is the authoritative "who approved this and why."
 *
 * CONFIDENCE:
 *   Engine-suggested opportunities carry a confidence level.
 *   Manual opportunities have null confidence.
 *   Confidence is advisory only — humans may qualify low-confidence suggestions.
 *
 * IMMUTABLE FIELDS: id, organization_id, execution_case_id, opportunity_type,
 *   detected_at, created_at.
 *
 * QUEUE COMPATIBILITY: requires_review, is_pending_review, is_blocked, is_stale
 *   enable queue engine queries without schema changes.
 *
 * Architecture ref: execution-workflows.md §5, data-model-v1.md §2.9,
 *                   AI_BOUNDARIES.md (engine permissions).
 */

import {
  pgTable, uuid, text, timestamp, boolean, jsonb, index,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import { explanationBundles } from './explanation-bundle.ts'
import {
  opportunityTypeEnum,
  opportunityStatusEnum,
} from './_enums-deadline-opportunity.ts'
import { confidenceLevelEnum } from './_enums-domain.ts'

export const opportunities = pgTable(
  'opportunities',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    // -------------------------------------------------------------------------
    // Tenant isolation — immutable
    // -------------------------------------------------------------------------

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Case linkage — immutable
    // -------------------------------------------------------------------------

    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Type classification — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * The specific type of procedural advantage.
     * Immutable after creation — determines data requirements, AI permissions,
     * piece categories, and human gate rules.
     * Architecture ref: execution-workflows.md §5.2.
     */
    opportunityType: opportunityTypeEnum('opportunity_type').notNull(),

    // -------------------------------------------------------------------------
    // Lifecycle status
    // -------------------------------------------------------------------------

    /**
     * Current lifecycle state.
     * Transitions require an OpportunityReview row + AuditLog entry.
     * Terminal states: realized, dismissed, expired.
     */
    status: opportunityStatusEnum('status').notNull().default('suggested'),

    // -------------------------------------------------------------------------
    // Detection / qualification timing
    // -------------------------------------------------------------------------

    /**
     * When this opportunity was first detected.
     * IMMUTABLE — set at creation, never updated.
     * TWO-CLOCK: this is the system detection time (wall clock), not a legal date.
     */
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * When a lawyer promoted this from suggested → qualified.
     * Set at the qualified transition; null until then.
     */
    qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
    qualifiedByUserId: uuid('qualified_by_user_id').references(() => users.id),

    // -------------------------------------------------------------------------
    // Opportunity window
    // -------------------------------------------------------------------------

    /**
     * When the opportunity window opens (the earliest date action is meaningful).
     * Null if the window is already open or not time-bounded.
     */
    windowStartAt: timestamp('window_start_at', { withTimezone: true }),

    /**
     * When the opportunity window closes.
     * Null if unbounded (some opportunities have no hard deadline).
     * The engine transitions to 'expired' when NOW() > window_end_at AND status non-terminal.
     */
    windowEndAt: timestamp('window_end_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Content
    // -------------------------------------------------------------------------

    /**
     * Human-readable summary of why this is an opportunity.
     * Required. Written by engine or manually.
     * Example: "Cliente cumpriu 1/6 da pena — elegível para progressão ao semiaberto."
     */
    summary: text('summary').notNull(),

    /**
     * Extended rationale and legal basis.
     * Optional but required for 'qualifying' — reviewed and confirmed by lawyer.
     * Example: "LEP art. 112 §1 — requisito temporal cumprido em 15/04/2024. ..."
     */
    rationale: text('rationale'),

    // -------------------------------------------------------------------------
    // Confidence (engine-assigned; null for manual)
    // -------------------------------------------------------------------------

    /**
     * Confidence level of the engine's assessment.
     * Null for manually created opportunities.
     * Advisory only — lawyers may qualify low-confidence suggestions.
     * Architecture ref: execution-engine.md §5 (confidence model).
     */
    confidenceLevel: confidenceLevelEnum('confidence_level'),

    /**
     * Specific uncertainty factors affecting this suggestion.
     * Schema: [{ factor: string, impact: 'high'|'medium'|'low', description: string }]
     *
     * Examples:
     *   - Missing confirmed work certificate (affects remission calculation)
     *   - Unconfirmed falta grave in window (affects progression eligibility)
     *   - No confirmed sentence snapshot (affects all arithmetic-based types)
     */
    uncertaintyFlags: jsonb('uncertainty_flags'),

    // -------------------------------------------------------------------------
    // Blocking and missing data
    // -------------------------------------------------------------------------

    /**
     * Conditions that must be resolved before this opportunity can be qualified.
     * Schema: [{ condition: string, type: 'missing_data'|'pending_review'|'dependency', entityRef?: string }]
     * Null when no blocking conditions exist.
     */
    blockingConditions: jsonb('blocking_conditions'),

    /**
     * Documents or data records required but not yet available.
     * Schema: [{ required: string, reason: string, urgency: 'required'|'recommended' }]
     */
    requiredDocuments: jsonb('required_documents'),

    /**
     * Data fields needed from the case but not yet confirmed.
     * Schema: [{ field: string, source: string, reason: string }]
     */
    missingDataFields: jsonb('missing_data_fields'),

    // -------------------------------------------------------------------------
    // Source references (immutable provenance)
    // -------------------------------------------------------------------------

    /**
     * SentenceSnapshot ID used by the engine to detect this opportunity.
     * Null for manually created or non-arithmetic opportunities.
     */
    sentenceSnapshotId: uuid('sentence_snapshot_id'),

    /**
     * AIAnalysis run that proposed this opportunity.
     * Null for manually created opportunities.
     */
    sourceAnalysisId: uuid('source_analysis_id'),

    /**
     * TimelineEvent that triggered this opportunity detection.
     * Example: a 'disciplinary.sanction' event triggers a 'pad_challenge' opportunity.
     */
    sourceEventId: uuid('source_event_id'),

    /**
     * Playbook version used to evaluate this opportunity.
     * Future-safe — allows replaying against updated playbooks.
     */
    playbookVersionId: uuid('playbook_version_id'),

    /**
     * Reusable structured JSON explanation produced by the engine.
     * Replaces direct JSONB attachment to allow polymorphic use by deadlines/projections.
     */
    explanationBundleId: uuid('explanation_bundle_id').references(() => explanationBundles.id),

    // -------------------------------------------------------------------------

    // Legal basis
    // -------------------------------------------------------------------------

    /**
     * Legal provision(s) supporting this opportunity.
     * Free text; engine-generated or human-written.
     * Example: "LEP art. 112, CP art. 33, STJ Súmula 715".
     */
    legalBasis: text('legal_basis'),

    // -------------------------------------------------------------------------
    // Outcome references
    // -------------------------------------------------------------------------

    /**
     * PieceDraft ID when this opportunity was realized via a piece.
     * Set at the 'realized' transition.
     */
    realizedPieceDraftId: uuid('realized_piece_draft_id'),

    // -------------------------------------------------------------------------
    // Terminal state timestamps and attribution
    // -------------------------------------------------------------------------

    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedByUserId: uuid('dismissed_by_user_id').references(() => users.id),

    /** Required reason for all dismissals. */
    dismissedReason: text('dismissed_reason'),

    /** The engine sets this when the window closes. */
    expiredAt: timestamp('expired_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Queue compatibility flags (mutable — engine-managed Phase 6+)
    // -------------------------------------------------------------------------

    /**
     * Whether this opportunity requires human review before action can proceed.
     * true: a lawyer must actively review and qualify/dismiss.
     * false: informational; no action gate.
     * Default: true (all opportunities require review before pursuing).
     */
    requiresReview: boolean('requires_review').notNull().default(true),

    /**
     * Whether this opportunity is currently awaiting a specific review action.
     * Set to true when a review is requested but not yet completed.
     * Cleared when the review is completed.
     * Enables queue filter: "show me opportunities awaiting my review."
     */
    isPendingReview: boolean('is_pending_review').notNull().default(false),

    /**
     * Whether a blocking condition is active.
     * Enables queue filter: "show me blocked opportunities."
     * Managed by engine/service when blockingConditions changes.
     */
    isBlocked: boolean('is_blocked').notNull().default(false),

    /**
     * Whether the underlying data is stale (old snapshot, outdated calculation).
     * A stale opportunity should not be qualified without re-evaluation.
     * Set by engine when source snapshot changes.
     */
    isStale: boolean('is_stale').notNull().default(false),

    // -------------------------------------------------------------------------
    // Provenance — immutable
    // -------------------------------------------------------------------------

    /**
     * System time of creation. Immutable.
     * For engine-generated: when the engine run completed.
     * For manual: when the user submitted the form.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * User who created this. Null for engine/system-generated.
     * Immutable after creation.
     */
    createdByUserId: uuid('created_by_user_id').references(() => users.id),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Primary queue query: "all suggested/qualified opportunities for org X"
     * Covers the main opportunity queue display.
     */
    index('opportunities_org_status_idx').on(
      table.organizationId,
      table.status,
      table.detectedAt
    ),

    /**
     * Case-scoped opportunity list.
     */
    index('opportunities_case_idx').on(
      table.executionCaseId,
      table.status
    ),

    /**
     * Type-scoped queue: "all progression opportunities in the org"
     * Used for bulk review workflows (e.g., indulto/comutação decree).
     */
    index('opportunities_type_status_idx').on(
      table.organizationId,
      table.opportunityType,
      table.status
    ),

    /**
     * Pending review queue: "opportunities awaiting my review"
     */
    index('opportunities_pending_review_idx').on(
      table.organizationId,
      table.isPendingReview,
      table.status
    ),

    /**
     * Window expiry sweep: engine queries opportunities approaching window_end_at
     */
    index('opportunities_window_idx').on(
      table.organizationId,
      table.windowEndAt,
      table.status
    ),

    /**
     * Blocked opportunities queue.
     */
    index('opportunities_blocked_idx').on(
      table.organizationId,
      table.isBlocked
    ),
  ]
)

export type Opportunity = typeof opportunities.$inferSelect
export type NewOpportunity = typeof opportunities.$inferInsert
