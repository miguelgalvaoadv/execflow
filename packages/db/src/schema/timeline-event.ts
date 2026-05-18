/**
 * TimelineEvent — append-only, immutable record of facts in a case's legal history.
 *
 * This is the legal narrative of a case. Every event that matters legally or
 * operationally for a client's execution is recorded here. The timeline is the
 * source of truth that the execution engine reads to compute current state.
 *
 * APPEND-ONLY CONTRACT (critical):
 * - NO UPDATE statements are ever issued against this table.
 * - NO DELETE statements are ever issued against this table.
 * - No updated_at column exists — this would imply mutability.
 * - No deleted_at column exists — soft-delete is forbidden.
 * - Corrections are new events with amends_event_id pointing to the error.
 *   The corrected event remains in history, clearly marked as superseded.
 *
 * "The legal history of a case is NEVER rewritten. An error becomes part of
 * the record. The correction is also part of the record."
 * Architecture ref: ENGINEERING_PRINCIPLES.md §2, ARCHITECTURE_RULES.md §D-01.
 *
 * TWO-CLOCK PRINCIPLE (critical for legal correctness):
 * - occurred_at: LEGAL TIME — when the event actually happened in the real world.
 *   Examples: date of court hearing, date of disciplinary sanction, date of
 *   transfer, date of sentença. This is what matters for legal calculations.
 *   May be retroactively entered (e.g., recording a transfer that happened 3 months ago).
 * - recorded_at: SYSTEM TIME — when this row was inserted into the database.
 *   Always the actual server clock. IMMUTABLE. Used for: ingestion audit, ordering
 *   events inserted on the same occurred_at, replay debugging.
 *
 * Conflating occurred_at and recorded_at would corrupt all temporal calculations.
 * Architecture ref: execution-engine.md §0, event-state-architecture.md §10.
 *
 * EVENT TYPE VOCABULARY:
 * event_type is a dot-namespaced free-text field for fine-grained event identity.
 * event_category provides broad filtering.
 *
 * Common event_type values (not exhaustive — the list grows with domain knowledge):
 * Court:     court.hearing, court.despacho, court.sentenca_progressao,
 *            court.hc_granted, court.hc_denied, court.writ_issued
 * Prison:    prison.transfer, prison.entry, prison.release_temporary,
 *            prison.work_credit_granted, prison.study_credit_granted
 * Sentence:  sentence.progressao, sentence.regressao, sentence.unificacao,
 *            sentence.recalculo, sentence.extincao
 * Benefit:   benefit.remicao_granted, benefit.detracado_applied,
 *            benefit.indulto_granted, benefit.livramento_conditional
 * Legal:     legal.petition_filed, legal.hc_filed, legal.requerimento_filed
 * Discipline:discipline.falta_grave, discipline.pad_opened, discipline.pad_result
 *
 * AI ATTRIBUTION:
 * When an AI system suggests or generates an event, actor_type = 'agent' and
 * ai_confidence + ai_model_id are set. AI events CANNOT be used as engine inputs
 * without human promotion (confirmed by a lawyer). This enforces the principle:
 * "AI suggests, humans decide." ARCHITECTURE_RULES.md §A-01.
 *
 * PAYLOAD SCHEMA:
 * payload is event_type–specific. The schema for each event_type is defined
 * in the playbook system and validated at the service layer.
 * The DB stores opaque JSON; validation lives outside the schema layer.
 * Architecture ref: playbook-system.md §4 (event payload contracts).
 *
 * Architecture ref: data-model-v1.md §2.5, execution-workflows.md §3,
 *                   event-state-architecture.md §3.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  numeric,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import {
  timelineEventCategoryEnum,
  timelineEventSourceEnum,
  timelineVisibilityEnum,
} from './_enums-domain.ts'

export const timelineEvents = pgTable(
  'timeline_events',
  {
    // -------------------------------------------------------------------------
    // Identity (immutable — all fields in this table are immutable)
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Tenant isolation. Immutable.
     * Denormalized from execution_case for efficient org-level queries.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The execution case this event belongs to.
     * ALL timeline queries are scoped by execution_case_id.
     */
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Event classification
    // -------------------------------------------------------------------------

    /**
     * Fine-grained event type identifier. Dot-namespaced.
     * Free text: allows new event types without schema migration.
     * The playbook system defines the vocabulary and payload contracts.
     * Example: 'court.hearing', 'discipline.falta_grave', 'sentence.progressao'
     */
    eventType: text('event_type').notNull(),

    /**
     * Broad category for query filtering.
     * event_type carries the precise identity; event_category enables UI grouping
     * and index-based filtering without full-text search.
     */
    eventCategory: timelineEventCategoryEnum('event_category').notNull(),

    // -------------------------------------------------------------------------
    // Temporal — THE KEY DISTINCTION (see module comment)
    // -------------------------------------------------------------------------

    /**
     * LEGAL TIME: when this event actually occurred in the real world.
     *
     * This is the date the court held the hearing, the date of the transfer,
     * the date the disciplinary sanction was applied. NOT the date it was
     * entered into EXECFLOW.
     *
     * May be retroactively entered (months or years after the fact).
     * The engine uses this for: sentence fraction calculations, deadline
     * anchoring, progression eligibility windows.
     *
     * IMMUTABLE: corrections create new events with amends_event_id.
     * If occurred_at was entered incorrectly, create a new corrective event.
     * Architecture ref: execution-engine.md §0 (two clocks).
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    /**
     * SYSTEM TIME: when this row was inserted into the database.
     * Always the actual server clock. IMMUTABLE. Set by defaultNow().
     *
     * Ingestion lag = recorded_at − occurred_at.
     * Large lag is expected for historical data entry and retroactive imports.
     * Used for: ingestion SLA monitoring, audit ordering, replay debugging.
     */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Content
    // -------------------------------------------------------------------------

    /**
     * Human-readable summary of the event.
     * Used in timeline display and legal narrative generation.
     * Example: "Audiência de progressão realizada. Juiz deferiu."
     */
    summary: text('summary').notNull(),

    /**
     * Event-type–specific structured payload.
     * Schema defined per event_type in playbook-system.md §4.
     * Validated at service layer; stored as opaque JSON here.
     * May contain: court references, document ids, sentence deltas,
     *              discipline details, credit amounts, etc.
     */
    payload: jsonb('payload').notNull().default({}),

    // -------------------------------------------------------------------------
    // Source and provenance
    // -------------------------------------------------------------------------

    /**
     * How this event originated.
     * manual       → Human explicitly created it.
     * document     → Generated from confirmed document (OCR extraction result).
     * integration  → Received from external system (tribunal connector, etc.).
     * ai_suggestion→ AI system suggested this event (requires human promotion).
     * system_rule  → Generated by a rule engine or scheduled job.
     */
    source: timelineEventSourceEnum('source').notNull(),

    /**
     * Polymorphic source reference type.
     * Example values: 'Document', 'IntakeBundle', 'AIAnalysis', 'ExternalEvent'
     * Used with source_ref_id to trace back to the origin artifact.
     */
    sourceRefType: text('source_ref_type'),

    /**
     * Polymorphic source reference ID.
     * UUID of the source record (Document.id, AIAnalysis.id, etc.).
     * NULL when source = 'manual' or 'system_rule' with no specific artifact.
     */
    sourceRefId: uuid('source_ref_id'),

    // -------------------------------------------------------------------------
    // Actor attribution (two-layer: human + system actor)
    // -------------------------------------------------------------------------

    /**
     * The human user who recorded this event.
     * NULL for fully automated events (system_rule, integration).
     * For ai_suggestion: the user who promoted the AI suggestion to a real event.
     * This ensures AI events always have a human who accepted responsibility.
     * AI_BOUNDARIES.md: "AI suggestions require human promotion."
     */
    authorUserId: uuid('author_user_id').references(() => users.id),

    /**
     * Type of actor who created this event.
     * Matches actorTypeEnum from _enums.ts: 'user' | 'system' | 'agent'
     * Stored as text for cross-enum compatibility (references same vocabulary).
     */
    actorType: text('actor_type').notNull().default('user'),

    /**
     * Actor ID for the event creator.
     * For actorType='user': user UUID.
     * For actorType='system': system service identifier string.
     * For actorType='agent': AI agent identifier.
     * Mirrors AuditLog.actor_id semantics for cross-entity joins.
     */
    actorId: text('actor_id').notNull(),

    // -------------------------------------------------------------------------
    // Visibility control
    // -------------------------------------------------------------------------

    /**
     * Who can see this event.
     * legal    → Visible in court-facing output (legal narrative export).
     * internal → Office-only (strategy, observations, uncertainties).
     * both     → Visible everywhere.
     *
     * 'internal' events NEVER appear in documents sent to courts or clients.
     * Architecture ref: data-model-v1.md §2.5, ux-flow-architecture.md §3.2.
     */
    visibility: timelineVisibilityEnum('visibility').notNull().default('both'),

    // -------------------------------------------------------------------------
    // AI attribution (for source = 'ai_suggestion')
    // -------------------------------------------------------------------------

    /**
     * AI confidence score for this event (when source = 'ai_suggestion').
     * Range: 0.0000 to 1.0000 (stored as 5-digit numeric for precision).
     * NULL when source ≠ 'ai_suggestion'.
     * Used for: review prioritization, engine input eligibility filtering.
     * Architecture ref: AI_BOUNDARIES.md.
     */
    aiConfidence: numeric('ai_confidence', { precision: 5, scale: 4 }),

    /**
     * AI model identifier that generated this event.
     * NULL when source ≠ 'ai_suggestion'.
     * Retained for: audit traceability, model version accountability.
     */
    aiModelId: text('ai_model_id'),

    // -------------------------------------------------------------------------
    // Amendment chain (corrections via new records — NEVER in-place edits)
    // -------------------------------------------------------------------------

    /**
     * When this event CORRECTS a prior erroneous event, this points to
     * the event being corrected. The old event remains in the timeline;
     * queries should filter it out using this pointer.
     *
     * Pattern: "show current events" = WHERE amends_event_id IS NULL AND
     *          id NOT IN (SELECT amends_event_id FROM timeline_events
     *                     WHERE amends_event_id IS NOT NULL)
     *
     * NULL for original (non-corrective) events.
     * Architecture ref: data-model-v1.md §2.5 "corrections = new event with amends_event_id."
     */
    amendsEventId: uuid('amends_event_id').references(
      (): AnyPgColumn => timelineEvents.id
    ),

    // -------------------------------------------------------------------------
    // NO updated_at, NO deleted_at — this table is APPEND-ONLY
    // -------------------------------------------------------------------------
  },
  (table) => [
    /**
     * PRIMARY TIMELINE QUERY: chronological event listing for a case.
     * Supports both forward (ASC) and reverse (DESC) timeline reconstruction.
     * This is the most frequently executed query in EXECFLOW.
     */
    index('timeline_events_case_occurred_idx').on(
      table.executionCaseId,
      table.occurredAt
    ),

    /**
     * FILTERED TIMELINE: events by category + occurred_at for specific views
     * (e.g., "show only court events", "show only benefit events").
     */
    index('timeline_events_case_category_idx').on(
      table.executionCaseId,
      table.eventCategory,
      table.occurredAt
    ),

    /**
     * REPLAY RECONSTRUCTION: ordered by both clocks.
     * Use when replaying: "what was known by system on date X?"
     * Uses recorded_at to determine which rows existed at replay time.
     * Architecture ref: execution-engine.md §7 (historical replay).
     */
    index('timeline_events_replay_idx').on(
      table.executionCaseId,
      table.recordedAt,
      table.occurredAt
    ),

    /**
     * ORG-LEVEL AUDIT STREAM: all events across org ordered by ingestion time.
     * Used for compliance review and operational monitoring.
     */
    index('timeline_events_org_recorded_idx').on(
      table.organizationId,
      table.recordedAt
    ),

    /**
     * AMENDMENT LOOKUP: find corrective events for a given source event.
     * Enables the "show current (non-corrected) events only" query.
     */
    index('timeline_events_amends_idx').on(table.amendsEventId),
  ]
)

export type TimelineEvent = typeof timelineEvents.$inferSelect
export type NewTimelineEvent = typeof timelineEvents.$inferInsert
