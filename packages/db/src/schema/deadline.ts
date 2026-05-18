/**
 * Deadline — time-bound obligation for an execution case.
 *
 * Deadlines represent legal, operational, and SLA obligations:
 *   - Court-facing deadlines (manifestação, recurso, cumprimento de despacho)
 *   - Benefit windows (prazo para requerer progressão)
 *   - PAD defense windows
 *   - Internal SLAs (firm-imposed review deadlines)
 *   - Recurring reviews (quarterly case health, benefit eligibility screens)
 *
 * STATE MACHINE:
 *   open → acknowledged → overdue → completed (terminal)
 *   open → acknowledged → overdue → dismissed (terminal, lawyer-only)
 *   open → overdue (time-based; engine sets this explicitly)
 *   open → completed | dismissed (direct transitions also allowed)
 *
 * IMMUTABLE FIELDS: id, organization_id, execution_case_id, origin, created_at,
 *   created_by_user_id. All other fields are mutable with an audit trail.
 *
 * DUE DATE HISTORY: every change to due_at appends a DeadlineHistory row.
 *   See deadline-history.ts.
 *
 * QUEUE COMPATIBILITY: escalation_level and is_blocked support future queue
 *   engine integration without schema changes.
 *
 * Architecture ref: execution-workflows.md §4, data-model-v1.md §2.8.
 */

import {
  pgTable, uuid, text, timestamp, boolean, integer,
  jsonb, index,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import {
  deadlineStatusEnum,
  deadlineClassEnum,
  deadlineOriginEnum,
  deadlinePriorityEnum,
} from './_enums-deadline-opportunity.ts'

export const deadlines = pgTable(
  'deadlines',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    // -------------------------------------------------------------------------
    // Tenant isolation — immutable
    // -------------------------------------------------------------------------

    /** Organization this deadline belongs to. Immutable. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Case linkage — immutable
    // -------------------------------------------------------------------------

    /** Execution case this deadline is attached to. Immutable. */
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Core deadline fields
    // -------------------------------------------------------------------------

    /** Short human-readable title. Example: "Manifestação — Despacho 15/03/2024". */
    title: text('title').notNull(),

    /** Extended description or legal basis elaboration. */
    description: text('description'),

    /**
     * Legal/operational due date.
     * MUTABLE — changes appended to deadline_history.
     * Use due_at for display; use deadline_history to reconstruct history.
     *
     * TWO-CLOCK NOTE: This is the LEGAL deadline date, not a system timestamp.
     */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),

    // -------------------------------------------------------------------------
    // Classification — immutable (origin) / mutable (class, priority)
    // -------------------------------------------------------------------------

    /**
     * Thematic class. Drives notification and escalation rules.
     * Architecture ref: execution-workflows.md §4.1.
     */
    deadlineClass: deadlineClassEnum('deadline_class').notNull(),

    /**
     * How this deadline was created.
     * IMMUTABLE after creation — never update this field.
     * Architecture ref: execution-workflows.md §4.2.
     */
    origin: deadlineOriginEnum('origin').notNull(),

    /** Display/alert priority. Mutable if circumstances change. */
    priority: deadlinePriorityEnum('priority').notNull().default('normal'),

    // -------------------------------------------------------------------------
    // Lifecycle status
    // -------------------------------------------------------------------------

    /**
     * Current lifecycle state.
     * Transitions require an AuditLog entry + DeadlineHistory row.
     * Terminal states: completed, dismissed.
     */
    status: deadlineStatusEnum('status').notNull().default('open'),

    // -------------------------------------------------------------------------
    // Assignment
    // -------------------------------------------------------------------------

    /** Optional user assigned to action this deadline. */
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),

    // -------------------------------------------------------------------------
    // Source references (immutable provenance links)
    // -------------------------------------------------------------------------

    /**
     * TimelineEvent that triggered this deadline (for engine/rule-generated deadlines).
     * Stored as text (not FK) to avoid constraint failures if the event is archived.
     */
    sourceEventId: uuid('source_event_id'),

    /**
     * Document that contains the deadline date (for extracted deadlines).
     */
    sourceDocumentId: uuid('source_document_id'),

    /**
     * Playbook version that generated this deadline (for rule-origin deadlines).
     * Stored as text for future-safe reference.
     */
    playbookVersionId: uuid('playbook_version_id'),

    /**
     * Legal provision or rule citation backing this deadline.
     * Example: "LEP art. 112 — progressão de regime fechado".
     */
    legalBasis: text('legal_basis'),

    // -------------------------------------------------------------------------
    // Recurring deadline support
    // -------------------------------------------------------------------------

    /**
     * Parent deadline in a recurring chain.
     * When this is a child of a recurring schedule, points to the parent.
     */
    parentDeadlineId: uuid('parent_deadline_id').references(
      (): AnyPgColumn => deadlines.id
    ),

    /**
     * Recurrence configuration. Null for non-recurring deadlines.
     * Schema: { cadenceDays?: number, nextDueOffset?: number, maxOccurrences?: number }
     * The engine (Phase 6+) reads this to spawn the next deadline on completion.
     */
    recurrencePattern: jsonb('recurrence_pattern'),

    // -------------------------------------------------------------------------
    // Escalation tracking (mutable — populated by queue engine Phase 6+)
    // -------------------------------------------------------------------------

    /**
     * Current escalation level.
     * 0 = no escalation
     * 1 = notified assignee
     * 2 = notified responsible lawyer
     * 3 = notified admin
     *
     * Architecture ref: execution-workflows.md §4.5.
     */
    escalationLevel: integer('escalation_level').notNull().default(0),

    /** When the current escalation level was reached. */
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Acknowledgement (open → acknowledged transition)
    // -------------------------------------------------------------------------

    /**
     * When the assignee acknowledged this deadline.
     * Acknowledgement is NOT completion — it means "I see this and I'm working on it."
     * Required transition for critical deadlines before engine stops escalating.
     */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedByUserId: uuid('acknowledged_by_user_id').references(() => users.id),

    // -------------------------------------------------------------------------
    // Completion evidence (completed terminal state)
    // -------------------------------------------------------------------------

    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id),

    /**
     * Polymorphic reference to the evidence of completion.
     * completionEvidenceType: 'timeline_event' | 'document' | 'manual' | 'filing'
     * completionEvidenceId: UUID of the referenced entity
     */
    completionEvidenceType: text('completion_evidence_type'),
    completionEvidenceId: text('completion_evidence_id'),

    // -------------------------------------------------------------------------
    // Dismissal (dismissed terminal state)
    // -------------------------------------------------------------------------

    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedByUserId: uuid('dismissed_by_user_id').references(() => users.id),

    /** Free-text reason. Required for ALL dismissals. */
    dismissedReason: text('dismissed_reason'),

    /**
     * Machine-readable reason code. REQUIRED for overdue deadline dismissals.
     * Example codes: 'completed_elsewhere', 'superseded', 'not_applicable',
     *               'court_extension', 'client_withdrawal'.
     */
    dismissedReasonCode: text('dismissed_reason_code'),

    // -------------------------------------------------------------------------
    // Queue compatibility flags (mutable — engine-managed Phase 6+)
    // -------------------------------------------------------------------------

    /**
     * Why this deadline cannot be actioned right now.
     * Null = no blocking condition.
     * Example: "Aguardando confirmação do documento X" or "Snapshot pendente de revisão".
     */
    blockingReason: text('blocking_reason'),

    /**
     * Whether a blocking condition is currently active.
     * Set/cleared by engine. Enables queue filter: "show me blocked deadlines."
     */
    isBlocked: boolean('is_blocked').notNull().default(false),

    /**
     * Whether the underlying data is stale (old snapshot, outdated calculation).
     * Stale deadlines require re-evaluation before action.
     * Set by engine when source data changes materially.
     */
    isStale: boolean('is_stale').notNull().default(false),

    /** Last time the engine checked this deadline against current case data. */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Provenance — immutable after creation
    // -------------------------------------------------------------------------

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Primary queue query: "all open deadlines for org X, ordered by due_at"
     * Covers the main deadline queue display.
     */
    index('deadlines_org_status_due_idx').on(
      table.organizationId,
      table.status,
      table.dueAt
    ),

    /**
     * Case-scoped deadline list: "all deadlines for case X"
     */
    index('deadlines_case_idx').on(
      table.executionCaseId,
      table.status,
      table.dueAt
    ),

    /**
     * Assignee queue: "all open deadlines assigned to user X"
     */
    index('deadlines_assignee_idx').on(
      table.assigneeUserId,
      table.status
    ),

    /**
     * Escalation sweep: "deadlines that need escalation check"
     * Engine uses: WHERE status IN ('open','acknowledged') AND escalation_level < 3
     */
    index('deadlines_escalation_idx').on(
      table.organizationId,
      table.escalationLevel,
      table.status
    ),

    /**
     * Blocked queue: "deadlines with active blocking conditions"
     */
    index('deadlines_blocked_idx').on(
      table.organizationId,
      table.isBlocked
    ),

    /**
     * Priority + overdue: critical-priority overdue deadlines surface first
     */
    index('deadlines_priority_idx').on(
      table.organizationId,
      table.priority,
      table.status
    ),
  ]
)

export type Deadline = typeof deadlines.$inferSelect
export type NewDeadline = typeof deadlines.$inferInsert
