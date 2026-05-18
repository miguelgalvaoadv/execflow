/**
 * QueueAssignment — append-only record of every ownership change on queue items.
 *
 * APPEND-ONLY CONTRACT: immutable after creation. No updates, no deletes.
 *
 * A QueueAssignment row is created whenever a queue item (QueueProjection) or
 * WorkflowTask changes ownership — whether by claim, release, supervisor assignment,
 * escalation, vacation coverage, or reassignment.
 *
 * This gives a complete history of "who had this item and when" — essential
 * for operational accountability in a legal practice context.
 *
 * Architecture ref: office-operating-system.md §3.4 (reassignment audit).
 */

import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'

export const queueAssignments = pgTable(
  'queue_assignments',
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
    // Target entity (what was assigned)
    // -------------------------------------------------------------------------

    /**
     * 'QueueProjection' or 'WorkflowTask'
     */
    targetEntityType: text('target_entity_type').notNull(),

    /** UUID of the QueueProjection or WorkflowTask being assigned. */
    targetEntityId: uuid('target_entity_id').notNull(),

    // -------------------------------------------------------------------------
    // Transition record
    // -------------------------------------------------------------------------

    /**
     * Type of assignment change.
     * 'claimed'           — user self-claimed from pool
     * 'released'          — user released back to pool
     * 'assigned'          — supervisor assigned to specific user
     * 'reassigned'        — moved from one user to another
     * 'escalated'         — ownership transferred due to SLA breach
     * 'coverage_started'  — vacation coverage activated
     * 'coverage_ended'    — vacation coverage ended; reverted to original
     * 'unassigned'        — removed from specific user (back to pool)
     */
    assignmentType: text('assignment_type').notNull(),

    /** User ID of the previous owner (null if was unassigned). */
    fromUserId: uuid('from_user_id'),

    /** User ID of the new owner (null if unassigned/returned to pool). */
    toUserId: uuid('to_user_id'),

    // -------------------------------------------------------------------------
    // Attribution
    // -------------------------------------------------------------------------

    /**
     * Who performed this assignment action.
     * For 'claimed': same as toUserId.
     * For 'released': same as fromUserId.
     * For 'assigned': the supervisor who assigned.
     * For 'escalated': the system/SLA monitor.
     */
    actedByUserId: uuid('acted_by_user_id'),

    /** Why this assignment occurred. Required for supervisor-initiated changes. */
    reason: text('reason'),

    /**
     * System time of this assignment.
     * Set by DB default — never set by application code.
     */
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Causality
    // -------------------------------------------------------------------------

    /** Domain event that triggered this assignment (for system-initiated assignments). */
    causingEventId: uuid('causing_event_id'),

    /** Correlation ID from the originating WriteContext. */
    correlationId: uuid('correlation_id').notNull(),

    /** Additional context. */
    metadata: jsonb('metadata'),
  },
  (table) => [
    /**
     * Assignment history for a specific queue item.
     */
    index('queue_assignments_entity_idx').on(
      table.targetEntityType,
      table.targetEntityId,
      table.assignedAt
    ),

    /**
     * User history: "all items ever assigned to user X in org Y"
     */
    index('queue_assignments_user_idx').on(
      table.organizationId,
      table.toUserId,
      table.assignedAt
    ),
  ]
)

export type QueueAssignment = typeof queueAssignments.$inferSelect
export type NewQueueAssignment = typeof queueAssignments.$inferInsert
