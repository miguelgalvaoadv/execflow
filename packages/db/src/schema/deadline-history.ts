/**
 * DeadlineHistory — append-only changelog for Deadline mutations.
 *
 * APPEND-ONLY CONTRACT:
 * Every material change to a Deadline produces a DeadlineHistory row.
 * No rows in this table are ever updated or deleted.
 *
 * WHEN IS A ROW WRITTEN:
 * - due_at changes (due date extension or correction)
 * - priority changes
 * - assignee changes
 * - status transitions (open→acknowledged, acknowledged→overdue, etc.)
 * - escalation level changes
 * - blocking condition changes
 *
 * STATUS TRANSITIONS specifically: the Deadline's status field is the
 * current state; DeadlineHistory is the authoritative record of HOW
 * and WHEN it got there. This enables legal defensibility
 * ("this deadline was acknowledged on date X by user Y").
 *
 * Architecture ref: data-model-v1.md §2.8 (Deadline immutable fields),
 *                   ENGINEERING_PRINCIPLES.md §2 (append-only history).
 */

import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { deadlines } from './deadline.ts'
import { users } from './user.ts'

export const deadlineHistory = pgTable(
  'deadline_history',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable after creation
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
    // Deadline reference
    // -------------------------------------------------------------------------

    deadlineId: uuid('deadline_id')
      .notNull()
      .references(() => deadlines.id),

    // -------------------------------------------------------------------------
    // Change description
    // -------------------------------------------------------------------------

    /**
     * Type of change recorded.
     * Convention: snake_case noun (what changed), not verb (what was done).
     *
     * Known values:
     *   'due_date_changed'      — due_at was updated
     *   'priority_changed'      — priority was updated
     *   'assignee_changed'      — assignee_user_id changed
     *   'status_changed'        — lifecycle state transition
     *   'escalation_changed'    — escalation_level changed
     *   'blocking_changed'      — blocking_reason / is_blocked changed
     *   'acknowledged'          — explicit acknowledgement transition
     *   'completed'             — completion transition
     *   'dismissed'             — dismissal transition
     */
    changeType: text('change_type').notNull(),

    /**
     * Value BEFORE the change. JSON-encoded.
     * Schema depends on change_type.
     *
     * Example for 'due_date_changed': { "dueAt": "2024-03-15T00:00:00Z" }
     * Example for 'status_changed':   { "status": "open" }
     */
    previousValue: jsonb('previous_value'),

    /**
     * Value AFTER the change. JSON-encoded.
     * Schema depends on change_type.
     */
    newValue: jsonb('new_value'),

    /**
     * Human-readable reason for the change.
     * Required for: due_date_changed, priority_changed (when downgraded).
     * Optional for: other changes.
     */
    reason: text('reason'),

    // -------------------------------------------------------------------------
    // Attribution — canonical actor model (matches opportunity_status_history)
    // -------------------------------------------------------------------------

    /**
     * Actor type who caused this change.
     * 'user': human action via API.
     * 'system': SLA sweep, engine-driven transition.
     * 'agent_*': AI-initiated (future).
     */
    changedByActorType: text('changed_by_actor_type').notNull(),

    /**
     * Actor identifier. Matches domain_events actor_id semantics.
     * For 'user': users.id UUID as text.
     * For 'system': worker name (e.g. sla-monitor.overdue-sweep).
     */
    changedByActorId: text('changed_by_actor_id').notNull(),

    /**
     * Denormalized users.id when changed_by_actor_type = 'user'.
     * NULL for system/agent transitions — never a fake system user UUID.
     */
    changedByUserId: uuid('changed_by_user_id').references(() => users.id),

    /**
     * System clock at the moment of change.
     * Set by DB default — never set by application code.
     * This is the authoritative "when did this change happen" timestamp.
     */
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Causality (for replay + event chain tracing)
    // -------------------------------------------------------------------------

    /**
     * The domain_event.id that caused this change.
     * Set when the transition is emitted alongside a domain event (e.g. overdue sweep).
     * Null for direct human API edits that initiate (not receive) causality chains.
     */
    causingEventId: uuid('causing_event_id'),

    /** Correlation ID propagated from the originating WriteContext. */
    correlationId: uuid('correlation_id').notNull(),
  },
  (table) => [
    /**
     * Primary query: "full change history for deadline X, oldest first"
     * Used for deadline detail view and legal defensibility.
     */
    index('deadline_history_deadline_idx').on(table.deadlineId, table.changedAt),

    /**
     * Org-scoped sweep: "all changes in org X during time range Y"
     * Used for compliance export.
     */
    index('deadline_history_org_idx').on(table.organizationId, table.changedAt),
  ]
)

export type DeadlineHistoryRecord = typeof deadlineHistory.$inferSelect
export type NewDeadlineHistoryRecord = typeof deadlineHistory.$inferInsert
