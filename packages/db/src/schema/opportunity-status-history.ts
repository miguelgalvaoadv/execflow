/**
 * OpportunityStatusHistory — append-only record of every status transition.
 *
 * APPEND-ONLY CONTRACT: every row is permanent; no updates, no deletes.
 *
 * RELATIONSHIP TO OpportunityReview:
 * - OpportunityReview records the HUMAN DECISION (what was decided and why).
 * - OpportunityStatusHistory records the STATE MACHINE TRANSITION (before → after).
 * These are complementary: you need both for full auditability.
 *
 * For human-initiated transitions: both records are written in the same transaction.
 * For engine/system transitions (e.g., expiry when window closes): only a status
 * history row is written (no review row — the engine is not a human reviewer).
 *
 * REPLAY SAFETY:
 * This table is the authoritative record for reconstructing an opportunity's
 * historical state at any point in time. Query by opportunity_id + changed_at ≤ target_time
 * to reconstruct the status at any past moment.
 *
 * Architecture ref: event-state-architecture.md §3 (state machine discipline).
 */

import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { opportunities } from './opportunity.ts'
import { opportunityStatusEnum } from './_enums-deadline-opportunity.ts'

export const opportunityStatusHistory = pgTable(
  'opportunity_status_history',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    // -------------------------------------------------------------------------
    // Tenant isolation
    // -------------------------------------------------------------------------

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
    // Transition record
    // -------------------------------------------------------------------------

    /** Status before this transition. */
    previousStatus: opportunityStatusEnum('previous_status').notNull(),

    /** Status after this transition. */
    newStatus: opportunityStatusEnum('new_status').notNull(),

    // -------------------------------------------------------------------------
    // Attribution
    // -------------------------------------------------------------------------

    /**
     * Actor type who caused this transition.
     * 'user': human review action.
     * 'system': engine-driven transition (expiry, stale detection).
     * 'agent_*': AI-initiated (Phase 6+ — currently only humans change status).
     */
    changedByActorType: text('changed_by_actor_type').notNull(),

    /**
     * Actor identifier. Matches actorTypeEnum semantics.
     * For 'user': users.id UUID.
     * For 'system': engine run identifier or worker name.
     */
    changedByActorId: text('changed_by_actor_id').notNull(),

    /**
     * System time of the transition.
     * Set by DB default — never set by application code.
     */
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Reason / context
    // -------------------------------------------------------------------------

    /**
     * Human-readable reason for this transition.
     * For human actions: extracted from the review explanation.
     * For system transitions: the system rule or condition description.
     */
    reason: text('reason'),

    /**
     * Reference to the OpportunityReview row that caused this transition.
     * Null for system-initiated transitions (expiry, etc.).
     */
    reviewId: uuid('review_id'),

    // -------------------------------------------------------------------------
    // Causality
    // -------------------------------------------------------------------------

    /**
     * DomainEvent ID that caused this transition.
     * Null for direct human reviews (they initiate causality chains, not receive them).
     */
    causingEventId: uuid('causing_event_id'),

    /** Correlation ID propagated from the originating WriteContext. */
    correlationId: uuid('correlation_id').notNull(),

    /**
     * Additional context snapshot for replay.
     * Schema varies by transition type.
     * For engine transitions: { engineRunId, playbookVersionId, snapshotIds }
     */
    metadata: jsonb('metadata'),
  },
  (table) => [
    /**
     * Primary replay query: "full status history for opportunity X"
     */
    index('opp_status_history_opp_idx').on(table.opportunityId, table.changedAt),

    /**
     * Org-scoped compliance export: "all transitions in org X"
     */
    index('opp_status_history_org_idx').on(table.organizationId, table.changedAt),

    /**
     * Transition type query: "all qualifications in org X during period"
     */
    index('opp_status_history_new_status_idx').on(
      table.organizationId,
      table.newStatus,
      table.changedAt
    ),
  ]
)

export type OpportunityStatusHistoryRecord = typeof opportunityStatusHistory.$inferSelect
export type NewOpportunityStatusHistoryRecord = typeof opportunityStatusHistory.$inferInsert
