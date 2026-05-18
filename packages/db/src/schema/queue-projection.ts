/**
 * QueueProjection — materialized queue item entry.
 *
 * A QueueProjection is a denormalized, mutable record representing one item
 * currently in the operational queue system. It is NOT the source of truth —
 * it is a derived, queryable projection of entity state.
 *
 * SOURCE OF TRUTH:
 * The source of truth is always the originating entity (Deadline, Opportunity,
 * IntakeBundle, WorkflowTask) plus its DomainEvent history. QueueProjection
 * can be deleted and entirely rebuilt from those sources.
 *
 * REPLAY-SAFE DESIGN:
 * Rebuild algorithm:
 *   1. Delete all queue_projections for org X
 *   2. Replay domain_events for org X in order (by occurred_at)
 *   3. For each event, apply the same logic as the event consumer
 *   4. Result = current queue state
 *
 * MATERIALIZATION RATIONALE:
 * A live SQL view over deadlines + opportunities + intake_bundles would be:
 * - Complex to index for queue-priority ordering
 * - Hard to add computed fields (escalation_level, sla_breached_at)
 * - Unable to track deferred/snoozed state independently of source entity
 *
 * The projection table trades write complexity for read simplicity.
 * Queue reads are frequent and must be fast; queue writes (from events) are async.
 *
 * MUTABLE FIELDS:
 * All fields except id, organization_id, queue_type, entity_type, entity_id,
 * source_causing_event_id, created_at are mutable — updated by event consumers.
 *
 * Architecture ref: office-operating-system.md §2, event-state-architecture.md §4.
 */

import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb, index, unique,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { queueTypeEnum, queueProjectionStatusEnum } from './_enums-queue.ts'

export const queueProjections = pgTable(
  'queue_projections',
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
    // Queue classification — immutable
    // -------------------------------------------------------------------------

    /**
     * Which named queue this item belongs to.
     * Immutable after creation — if an item moves to a different queue,
     * the old projection is resolved and a new one is created.
     */
    queueType: queueTypeEnum('queue_type').notNull(),

    /**
     * The entity type this projection represents.
     * Values: 'Deadline', 'Opportunity', 'IntakeBundle', 'WorkflowTask',
     *         'Document', 'SentenceSnapshot'
     */
    entityType: text('entity_type').notNull(),

    /**
     * UUID of the source entity.
     * Combined with entityType to form the polymorphic reference.
     * IMMUTABLE — the projection always refers to the same source entity.
     */
    entityId: uuid('entity_id').notNull(),

    // -------------------------------------------------------------------------
    // Case linkage (optional — not all queue items are case-scoped)
    // -------------------------------------------------------------------------

    /**
     * Execution case this item belongs to.
     * Null for org-level queue items (e.g., intake review before case association).
     */
    executionCaseId: uuid('execution_case_id'),

    // -------------------------------------------------------------------------
    // Lifecycle status
    // -------------------------------------------------------------------------

    /**
     * Current lifecycle state.
     * Terminal state: resolved.
     * Snoozed/deferred are only allowed for non-critical items.
     */
    status: queueProjectionStatusEnum('status').notNull().default('active'),

    // -------------------------------------------------------------------------
    // Priority (office priority model)
    // -------------------------------------------------------------------------

    /**
     * Operational priority level (integer for computation flexibility):
     * 0 = interrupt (liberty risk, overdue critical legal deadline)
     * 1 = today (D-0/D-1 legal, piece in_review, PAD defense due today)
     * 2 = week (qualified opportunities, extraction backlog)
     * 3 = background (AI suggested, case health reviews, low confidence)
     *
     * Computed by event consumer from entity class + urgency + staleness.
     * Re-computed on significant events (escalation, due date change, etc.).
     * Architecture ref: office-operating-system.md §1.6.
     */
    priority: integer('priority').notNull().default(2),

    // -------------------------------------------------------------------------
    // Ownership
    // -------------------------------------------------------------------------

    /**
     * Current assigned user.
     * Null = unassigned (pool queue item).
     * Updated by QueueAssignment records; see queue-assignment.ts.
     */
    assigneeUserId: uuid('assignee_user_id'),

    /**
     * The user who is the responsible lawyer for this case/entity.
     * Separate from assigneeUserId — allows dual-visibility queries:
     * "show assignee queue" AND "show lawyer accountability queue".
     */
    responsibleLawyerUserId: uuid('responsible_lawyer_user_id'),

    // -------------------------------------------------------------------------
    // Escalation state
    // -------------------------------------------------------------------------

    /**
     * Current escalation level.
     * 0 = no escalation
     * 1 = assignee notified
     * 2 = responsible lawyer notified
     * 3 = admin/managing partner notified
     * Updated by SLA sweep + escalation engine.
     */
    escalationLevel: integer('escalation_level').notNull().default(0),

    /** When the current escalation level was last set. */
    lastEscalationAt: timestamp('last_escalation_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Blocking state
    // -------------------------------------------------------------------------

    /**
     * Whether this item is currently blocked.
     * Set by event consumers when blocking conditions are detected.
     * Cleared when the blocking condition is resolved.
     */
    isBlocked: boolean('is_blocked').notNull().default(false),

    /** Short description of why this item is blocked. */
    blockingReason: text('blocking_reason'),

    // -------------------------------------------------------------------------
    // Staleness
    // -------------------------------------------------------------------------

    /**
     * Whether the underlying data is stale (old snapshot, changed facts).
     * Set by event consumers when source entity data changes materially.
     * A stale queue item should not be acted on without re-evaluation.
     */
    isStale: boolean('is_stale').notNull().default(false),

    // -------------------------------------------------------------------------
    // SLA tracking
    // -------------------------------------------------------------------------

    /**
     * When the SLA for this queue item expires.
     * Derived from queue_type SLA rules + entry time.
     * Example: intake_review SLA = 24h from created_at.
     */
    slaDeadlineAt: timestamp('sla_deadline_at', { withTimezone: true }),

    /**
     * When the SLA was actually breached (null if not yet breached).
     * Set by SLA sweep when sla_deadline_at passes without resolution.
     * Immutable once set — even if item is resolved later, the breach is recorded.
     */
    slaBreachedAt: timestamp('sla_breached_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Snooze / Defer support
    // -------------------------------------------------------------------------

    /** When a snoozed item re-surfaces. Only set when status = 'snoozed'. */
    snoozeUntil: timestamp('snooze_until', { withTimezone: true }),

    /** When a deferred item re-surfaces. Only set when status = 'deferred'. */
    deferredUntil: timestamp('deferred_until', { withTimezone: true }),

    /** User who snoozed/deferred this item. */
    snoozedByUserId: uuid('snoozed_by_user_id'),

    // -------------------------------------------------------------------------
    // Denormalized display fields (mutable — updated by consumers)
    // -------------------------------------------------------------------------

    /**
     * Short display title for the queue item.
     * Copied from source entity; updated if source entity title changes.
     * Avoids JOIN to source entity for list display.
     */
    displayTitle: text('display_title').notNull().default(''),

    /**
     * Derived label for the deadline/opportunity type or document class.
     * Example: 'legal', 'progression', 'sentença', etc.
     */
    displayLabel: text('display_label'),

    /**
     * Key date for queue sorting and display.
     * For Deadline: due_at
     * For Opportunity: window_end_at or detected_at
     * For IntakeBundle: received_at
     */
    keyDate: timestamp('key_date', { withTimezone: true }),

    /**
     * Structured metadata for UI rendering.
     * Queue-type and entity-type-specific payload.
     * Example: { deadlineClass: 'legal', origin: 'rule', daysOverdue: 3 }
     */
    metadata: jsonb('metadata'),

    // -------------------------------------------------------------------------
    // Causality — immutable
    // -------------------------------------------------------------------------

    /**
     * The DomainEvent that caused this projection to be created.
     * Immutable. Used for replay to know which event triggered this projection.
     */
    sourceCausingEventId: uuid('source_causing_event_id'),

    // -------------------------------------------------------------------------
    // Provenance — immutable (createdAt) / mutable (updatedAt)
    // -------------------------------------------------------------------------

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * UNIQUE constraint: one active projection per entity per queue.
     * Prevents duplicate queue entries for the same entity.
     * Enables idempotent consumer logic: if projection exists, update; else insert.
     */
    unique('queue_proj_entity_unique').on(
      table.organizationId,
      table.queueType,
      table.entityType,
      table.entityId
    ),

    /**
     * PRIMARY QUEUE QUERY: "all active items in org X for queue Y, ordered by priority + key_date"
     * This is the most executed query in the system.
     */
    index('queue_proj_org_queue_priority_idx').on(
      table.organizationId,
      table.queueType,
      table.status,
      table.priority,
      table.keyDate
    ),

    /**
     * ASSIGNEE VIEW: "all my active queue items"
     */
    index('queue_proj_assignee_idx').on(
      table.assigneeUserId,
      table.status,
      table.priority
    ),

    /**
     * LAWYER VIEW: "all items I'm responsible for"
     */
    index('queue_proj_lawyer_idx').on(
      table.responsibleLawyerUserId,
      table.status,
      table.priority
    ),

    /**
     * SLA SWEEP: "queue items past SLA deadline that aren't yet breached"
     */
    index('queue_proj_sla_idx').on(
      table.organizationId,
      table.slaDeadlineAt,
      table.slaBreachedAt,
      table.status
    ),

    /**
     * ESCALATION SWEEP: "items needing escalation check"
     */
    index('queue_proj_escalation_idx').on(
      table.organizationId,
      table.escalationLevel,
      table.priority,
      table.status
    ),

    /**
     * SNOOZE WAKE: "snoozed items past snooze_until"
     */
    index('queue_proj_snooze_idx').on(
      table.organizationId,
      table.status,
      table.snoozeUntil
    ),

    /**
     * ENTITY LOOKUP: "find projection for a specific entity"
     */
    index('queue_proj_entity_idx').on(
      table.entityType,
      table.entityId
    ),
  ]
)

export type QueueProjection = typeof queueProjections.$inferSelect
export type NewQueueProjection = typeof queueProjections.$inferInsert
