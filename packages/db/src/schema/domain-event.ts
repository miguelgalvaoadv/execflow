/**
 * DomainEvent — the transactional outbox table and persistent event log.
 *
 * Dual purpose:
 * 1. OUTBOX: Events written here in the same transaction as their originating
 *    state change are picked up by the outbox relay worker and published to
 *    the pg-boss job queue for async consumers (engine, notifications, etc.).
 * 2. EVENT LOG: Published events are retained permanently as the system's
 *    event stream — enabling replay, debugging, and future analytics pipelines.
 *
 * IMPORTANT DISTINCTION from AuditLog:
 * - AuditLog records HUMAN-VISIBLE actions for legal accountability.
 * - DomainEvent records SYSTEM-LEVEL events for async propagation and replay.
 * - Many actions produce BOTH: a DomainEvent (for propagation) and an AuditLog
 *   entry (for legal traceability). They serve different purposes.
 *
 * IMMUTABILITY:
 * - The payload and all identity fields are immutable after creation.
 * - Only processing_status, published_at, failed_at, retry_count,
 *   last_error_message, and locked_until may be updated (by the relay worker).
 * - These updates are operational, not legal — they track delivery, not content.
 *
 * TEMPORAL MODEL:
 * - occurred_at: the LEGAL time the event happened in the domain (e.g., the
 *   date a court decision was issued, even if recorded days later).
 * - recorded_at: when the system wrote this record (server clock at insert time).
 * - These MUST be stored separately — conflating them is an architecture defect.
 *   Architecture ref: event-state-architecture.md §10.2, §10.4.
 *
 * CAUSALITY CHAIN:
 * - causation_id: the event_id of the event that directly caused this one.
 * - correlation_id: shared across all events in one logical operation chain.
 * These fields enable "show me everything that happened as a result of X".
 * Architecture ref: event-state-architecture.md §1.6 (explicit causality chains).
 *
 * Architecture ref: event-state-architecture.md §2 (event system model),
 *                   event-state-architecture.md §4.1 (queue-event integration),
 *                   technical-stack-decision.md §4.1 (transactional outbox).
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { eventProcessingStatusEnum } from './_enums.ts'

export const domainEvents = pgTable(
  'domain_events',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * Unique event identifier. Used as the primary key and as the causation_id
     * reference in downstream events. Consumers use this for idempotency checks.
     * Architecture ref: event-state-architecture.md §2.9 (idempotency expectations).
     */
    id: uuid('id').primaryKey().defaultRandom(),

    // -------------------------------------------------------------------------
    // Event classification — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * Namespaced event type identifier.
     * Convention: dot-namespaced, lowercase, domain-category.action pattern.
     * Examples:
     *   'document.confirmed'         → document extraction confirmed by assistant
     *   'snapshot.confirmed'         → sentence snapshot confirmed by lawyer
     *   'opportunity.qualified'      → opportunity qualified by lawyer
     *   'discipline.falta_grave'     → disciplinary event recorded
     *   'custody.transfer'           → prison transfer event
     *   'piece.approved'             → piece approved by lawyer
     *   'filing.confirmed'           → filing confirmed by assistant
     *
     * Full taxonomy: event-state-architecture.md §2.1 (event taxonomy).
     * Free text — not an enum — to allow new event types without migrations.
     */
    eventType: text('event_type').notNull(),

    /**
     * The domain aggregate type that this event concerns.
     * Convention: PascalCase, matching the entity concept.
     * Examples: 'ExecutionCase', 'Document', 'SentenceSnapshot', 'Opportunity'.
     */
    aggregateType: text('aggregate_type').notNull(),

    /**
     * UUID of the specific aggregate instance this event concerns.
     * Combined with aggregate_type, this identifies the exact entity.
     * Stored as UUID (not text) because aggregate IDs are always UUIDs.
     */
    aggregateId: uuid('aggregate_id').notNull(),

    // -------------------------------------------------------------------------
    // Causality chain — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * The event_id of the event that DIRECTLY caused this event.
     * Null for events that originate from human action (no prior event cause).
     * Enables traversal: "what chain of events led to this outcome?"
     * Architecture ref: event-state-architecture.md §1.6.
     */
    causationId: uuid('causation_id'),

    /**
     * Shared identifier across all events in one logical operation.
     * Set by the initiating action and propagated to all derived events.
     * Enables: "show me everything that happened as part of operation X".
     * For events originating from an HTTP request: use the request_id.
     */
    correlationId: uuid('correlation_id').notNull(),

    // -------------------------------------------------------------------------
    // Tenant context — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * Organization context for this event. Nullable for system-level events
     * (platform-wide) or events that occur before org association is known.
     * All org-scoped query patterns filter by this field.
     */
    organizationId: uuid('organization_id').references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Actor attribution — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * Type of the actor that generated this event.
     * Stored as text (not enum FK) to allow new actor types without a migration.
     * Expected values: see actorTypeEnum in _enums.ts.
     */
    actorType: text('actor_type').notNull(),

    /**
     * Identifier of the actor. Interpretation depends on actor_type:
     *   'user' → users.id UUID
     *   'agent_*' → agent instance identifier
     *   'system' → worker name / job id
     */
    actorId: text('actor_id').notNull(),

    // -------------------------------------------------------------------------
    // Temporal — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * When the domain event occurred in the real world (legal time).
     * For retroactive events (e.g., confirming a 2021 court decision in 2025),
     * this is the 2021 date — NOT the date of system recording.
     * The engine uses this for temporal calculations and history reconstruction.
     * Architecture ref: event-state-architecture.md §10.2, §10.3.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    /**
     * When this record was written to the database (system clock at insert time).
     * Always the current UTC timestamp. Never equals occurred_at for retroactive events.
     * Used for: outbox relay ordering, ingestion SLA calculations, system debugging.
     * Architecture ref: event-state-architecture.md §10.4 (ingestion dates vs event dates).
     */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Content — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * Structured event payload. Schema varies by event_type.
     * Consumers MUST use event_type to determine the expected payload shape.
     *
     * Payload should be self-contained: a consumer that reads only this record
     * (without querying other tables) should have sufficient data to process it.
     * Embed denormalized context (org name, entity current state) when needed
     * for replay safety — normalized FKs may resolve differently after future
     * schema changes.
     */
    payload: jsonb('payload').notNull(),

    /**
     * Additional metadata not part of the domain payload.
     * Known fields:
     *   request_id          (string) — OpenTelemetry trace correlation
     *   playbook_version_id (UUID)   — if the event involves legal rule application
     *   engine_run_id       (UUID)   — if the event was engine-produced
     *   mastra_workflow_id  (string) — if the event was AI-agent-produced
     */
    metadata: jsonb('metadata'),

    // -------------------------------------------------------------------------
    // Replay flag — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * Whether this event should be included in replay operations.
     * Most events are replayable (default: true).
     * Non-replayable events: notification dispatches, digest sends, and other
     * side-effect events that should NOT be re-fired during replay scenarios.
     * Architecture ref: event-state-architecture.md §2.10 (replay behavior).
     */
    replayable: boolean('replayable').notNull().default(true),

    // -------------------------------------------------------------------------
    // Outbox processing state — mutable by relay worker only
    // -------------------------------------------------------------------------

    /**
     * Current processing state in the outbox pipeline.
     * ONLY the outbox-relay worker may update this field.
     * Application code writes 'pending'; the relay transitions to the rest.
     * Architecture ref: event-state-architecture.md §2.7 (propagation),
     *                   event-state-architecture.md §4.5 (dead-letter handling).
     */
    processingStatus: eventProcessingStatusEnum('processing_status')
      .notNull()
      .default('pending'),

    /**
     * When the relay worker published this event to the pg-boss job queue.
     * Null until successfully published.
     */
    publishedAt: timestamp('published_at', { withTimezone: true }),

    /**
     * When the relay worker last failed to publish this event.
     * Null until the first failure. Combined with retry_count to determine
     * whether DLQ threshold has been reached.
     */
    failedAt: timestamp('failed_at', { withTimezone: true }),

    /**
     * Number of failed publication attempts.
     * When retry_count reaches the configured maximum, status transitions
     * to 'dead_lettered' and an admin alert is generated.
     */
    retryCount: integer('retry_count').notNull().default(0),

    /**
     * Human-readable error message from the last failed publication attempt.
     * Null until the first failure. Overwritten on each retry with the latest error.
     */
    lastErrorMessage: text('last_error_message'),

    /**
     * Optimistic row lock for the outbox relay worker.
     * The relay worker sets this to NOW() + interval when it picks up a row,
     * preventing other relay instances from processing the same event.
     * Uses SELECT ... FOR UPDATE SKIP LOCKED for concurrent safety.
     * Null when not locked. Cleared after successful publication.
     */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (table) => [
    /**
     * Primary outbox relay query:
     * "Give me pending events not currently locked, ordered by recorded_at."
     * The relay worker uses: WHERE processing_status = 'pending'
     *   AND (locked_until IS NULL OR locked_until < NOW())
     * SKIP LOCKED is applied at query time, not index level.
     */
    index('domain_events_outbox_idx').on(table.processingStatus, table.recordedAt),

    /**
     * Replay query pattern:
     * "All replayable events for aggregate X before date Y."
     */
    index('domain_events_aggregate_idx').on(
      table.aggregateType,
      table.aggregateId,
      table.occurredAt
    ),

    /**
     * Org-scoped event stream query:
     * "All events in org X in time range Y."
     * Used by analytics pipeline and audit export.
     */
    index('domain_events_org_occurred_idx').on(table.organizationId, table.occurredAt),

    /**
     * Causality chain traversal:
     * "All events directly caused by event X."
     */
    index('domain_events_causation_idx').on(table.causationId),

    /**
     * Correlation chain traversal:
     * "All events that are part of operation X."
     */
    index('domain_events_correlation_idx').on(table.correlationId),
  ]
)

export type DomainEvent = typeof domainEvents.$inferSelect
export type NewDomainEvent = typeof domainEvents.$inferInsert
