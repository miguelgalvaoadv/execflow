/**
 * OpportunityReview — append-only record of every human review action.
 *
 * APPEND-ONLY CONTRACT:
 * Every review action (qualify, reject, defer, escalate, etc.) creates
 * one new OpportunityReview row. No rows are ever updated or deleted.
 *
 * WHY APPEND-ONLY:
 * Opportunities involve decisions about liberty (progressão, HC, etc.).
 * The audit of WHO reviewed, WHEN, and WHY is a legal defensibility requirement.
 * A mutable review record would allow post-hoc rationalization.
 *
 * RELATIONSHIP TO OPPORTUNITY STATUS:
 * - When review_action = 'qualified': Opportunity.status → 'qualified'
 * - When review_action = 'rejected': Opportunity.status → 'dismissed'
 * - When review_action = 'deferred': Opportunity.status remains unchanged;
 *   is_pending_review cleared; deferred_until set
 * - When review_action = 'escalated': is_pending_review remains; routed to another user
 * - When review_action = 'pursuing_started': Opportunity.status → 'pursuing'
 * - When review_action = 'realized': Opportunity.status → 'realized'
 *
 * MANDATORY EXPLANATION:
 * All review actions require an explanation field.
 * This is non-negotiable — "I dismissed this" without rationale is not acceptable
 * for legal defensibility. The service layer enforces this.
 *
 * Architecture ref: data-model-v1.md §2.9, execution-workflows.md §5.4,
 *                   AI_BOUNDARIES.md (human gate requirement).
 */

import {
  pgTable, uuid, text, timestamp, jsonb, index,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { opportunities } from './opportunity.ts'
import { users } from './user.ts'
import {
  opportunityReviewActionEnum,
  opportunityStatusEnum,
} from './_enums-deadline-opportunity.ts'
import { confidenceLevelEnum } from './_enums-domain.ts'

export const opportunityReviews = pgTable(
  'opportunity_reviews',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    // -------------------------------------------------------------------------
    // Tenant isolation
    // -------------------------------------------------------------------------

    /** Denormalized for org-scoped history queries. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Opportunity reference
    // -------------------------------------------------------------------------

    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id),

    // -------------------------------------------------------------------------
    // Review action
    // -------------------------------------------------------------------------

    /**
     * The action taken by the reviewer.
     * Determines what status transition occurred on the Opportunity.
     * Architecture ref: opportunityReviewActionEnum values.
     */
    reviewAction: opportunityReviewActionEnum('review_action').notNull(),

    // -------------------------------------------------------------------------
    // Attribution — immutable
    // -------------------------------------------------------------------------

    /** The lawyer or authorized user who performed this review. */
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => users.id),

    /**
     * System time of the review.
     * Set by DB default — never set by application code.
     */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Mandatory explanation — non-negotiable
    // -------------------------------------------------------------------------

    /**
     * Why the reviewer took this action.
     * MANDATORY for all review actions — no exceptions.
     * For 'qualified': what the lawyer confirmed and their assessment.
     * For 'rejected': why this is not a real opportunity in this case.
     * For 'deferred': what is needed before re-evaluation.
     * For 'escalated': why this needs another lawyer's eyes.
     *
     * Architecture ref: AI_BOUNDARIES.md (human authority — explanations required).
     */
    explanation: text('explanation').notNull(),

    // -------------------------------------------------------------------------
    // Rejection specifics
    // -------------------------------------------------------------------------

    /**
     * Machine-readable rejection reason code.
     * Required when review_action = 'rejected'.
     *
     * Known codes:
     *   'not_applicable'      — opportunity type not relevant for this case
     *   'data_insufficient'   — not enough confirmed data to evaluate
     *   'timing_not_met'      — legal thresholds not yet met
     *   'prior_dismissal'     — already dismissed in earlier review cycle
     *   'superseded'          — another opportunity covers this
     *   'other'               — must have explanation text
     */
    rejectionReasonCode: text('rejection_reason_code'),

    // -------------------------------------------------------------------------
    // Deferral specifics
    // -------------------------------------------------------------------------

    /**
     * When to re-surface this opportunity for review.
     * Required when review_action = 'deferred'.
     */
    deferredUntil: timestamp('deferred_until', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Escalation specifics
    // -------------------------------------------------------------------------

    /**
     * The user this review is escalated to.
     * Required when review_action = 'escalated'.
     */
    escalatedToUserId: uuid('escalated_to_user_id').references(() => users.id),

    // -------------------------------------------------------------------------
    // State snapshot at review time (immutable provenance)
    // -------------------------------------------------------------------------

    /**
     * The opportunity's status at the moment of this review.
     * Captured so the review record is self-contained — even if future
     * transitions occur, the historical context is preserved.
     */
    opportunityStatusAtReview: opportunityStatusEnum('opportunity_status_at_review').notNull(),

    /**
     * The confidence level at review time.
     * Captured because engine may update confidence on subsequent runs.
     */
    confidenceLevelAtReview: confidenceLevelEnum('confidence_level_at_review'),

    /**
     * Key data snapshot used to make this decision.
     * Optional but encouraged for arithmetic-based opportunities.
     * Schema: { sentenceSnapshotId?: string, calculationSummary?: {...}, ... }
     */
    dataSnapshotRef: jsonb('data_snapshot_ref'),

    // -------------------------------------------------------------------------
    // Causality
    // -------------------------------------------------------------------------

    /** Correlation ID from the WriteContext that produced this review. */
    correlationId: uuid('correlation_id').notNull(),
  },
  (table) => [
    /**
     * Primary query: "full review history for opportunity X, chronological"
     */
    index('opportunity_reviews_opp_idx').on(table.opportunityId, table.reviewedAt),

    /**
     * Reviewer query: "all reviews performed by user X in org Y"
     */
    index('opportunity_reviews_reviewer_idx').on(
      table.organizationId,
      table.reviewerUserId,
      table.reviewedAt
    ),

    /**
     * Action-type query: "all qualifications in org X this month"
     */
    index('opportunity_reviews_action_idx').on(
      table.organizationId,
      table.reviewAction,
      table.reviewedAt
    ),
  ]
)

export type OpportunityReview = typeof opportunityReviews.$inferSelect
export type NewOpportunityReview = typeof opportunityReviews.$inferInsert
