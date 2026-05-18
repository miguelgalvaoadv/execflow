/**
 * AuditLog — the immutable, append-only record of every action in EXECFLOW.
 *
 * This is the most critical table in the system. It is the foundation of:
 * - Legal accountability ("who approved this piece?")
 * - Malpractice defense ("did the office know about this deadline?")
 * - LGPD compliance (access and modification tracking)
 * - Historical replay ("what did the system know on date X?")
 * - AI provenance ("which AI model produced which suggestion?")
 *
 * IMMUTABILITY CONTRACT (non-negotiable):
 * - No UPDATE statement is ever executed against this table.
 * - No DELETE statement is ever executed against this table.
 * - No soft-delete column (deleted_at) exists on this table.
 * - No foreign key with ON DELETE CASCADE references this table's id.
 * - The Drizzle client wrapper for this table exposes ONLY an insert method.
 *
 * WRITE CONTRACT:
 * - AuditLog writes are co-committed with the action they record (same transaction).
 * - An AuditLog entry that is NOT in the same transaction as its subject action
 *   is an architecture defect, not a retry candidate.
 *
 * RETENTION:
 * - Operational table retains the last N months (configurable per org).
 * - Older records are archived to Cloudflare R2 as JSONL, never deleted.
 * - Archive records remain queryable via the archive API.
 *
 * Architecture ref: event-state-architecture.md §8 (audit architecture),
 *                   ENGINEERING_PRINCIPLES.md §5 (auditability by default),
 *                   ARCHITECTURE_RULES.md §D-01 (no hard delete on legal history).
 */

import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { actorTypeEnum } from './_enums.ts'

export const auditLogs = pgTable(
  'audit_logs',
  {
    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------

    /** Opaque UUID primary key. Assigned at insert; never changes. */
    id: uuid('id').primaryKey().defaultRandom(),

    // -------------------------------------------------------------------------
    // Tenant isolation
    // -------------------------------------------------------------------------

    /**
     * Organization this action occurred within.
     * Nullable for system-level events (platform startup, cross-org admin actions).
     * All org-scoped queries MUST include organization_id in WHERE clause.
     * Architecture ref: ARCHITECTURE_RULES.md §M-01.
     */
    organizationId: uuid('organization_id').references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Actor attribution
    // -------------------------------------------------------------------------

    /**
     * Type of the actor that performed this action.
     * Determines how actor_id is interpreted:
     *   'user'               → actor_id is a users.id UUID
     *   'agent_*'            → actor_id is an agent instance identifier
     *   'system'             → actor_id is a worker/job identifier
     *   'admin_impersonating'→ actor_id is the admin's users.id;
     *                          impersonated_user_id holds the target user
     *
     * Architecture ref: event-state-architecture.md §8.2 (actor attribution),
     *                   AI_BOUNDARIES.md (AI attribution model).
     */
    actorType: actorTypeEnum('actor_type').notNull(),

    /**
     * Identifier of the actor. Interpretation depends on actor_type (see above).
     * Stored as text (not UUID FK) to accommodate non-user actor identifiers
     * (agent instance IDs, worker names) without FK constraint failures.
     */
    actorId: text('actor_id').notNull(),

    /**
     * Role of the actor within the organization at the time of the action.
     * Captured at write time — role changes do not retroactively alter past entries.
     * Null for system and agent actors (they have no org membership role).
     */
    actorRole: text('actor_role'),

    /**
     * When actor_type = 'admin_impersonating': the user whose session
     * was being impersonated. The admin's id is in actor_id.
     * This ensures impersonated actions are NEVER attributed to the target user.
     * Architecture ref: technical-stack-decision.md §5.1.
     */
    impersonatingUserId: uuid('impersonating_user_id'),

    /**
     * For AI agent actions: the model version that produced the output.
     * Format: provider/model@version e.g. "azure/gpt-4o@2024-11-20".
     * Stored for AI provenance tracing. Null for human actor actions.
     * Architecture ref: event-state-architecture.md §8.3 (AI attribution).
     */
    modelId: text('model_id'),

    // -------------------------------------------------------------------------
    // Action
    // -------------------------------------------------------------------------

    /**
     * Verb describing what the actor did.
     * Convention: past tense, lowercase, dot-namespaced where helpful.
     * Examples: 'created', 'confirmed', 'approved', 'dismissed', 'qualified',
     *           'snapshot.superseded', 'piece.approved', 'filing.confirmed'.
     * Free text — not an enum — because new action verbs are added as features
     * are built without requiring a schema migration each time.
     */
    action: text('action').notNull(),

    // -------------------------------------------------------------------------
    // Subject entity
    // -------------------------------------------------------------------------

    /**
     * The type of entity that was acted upon.
     * Convention: PascalCase, matching the Drizzle table name conceptually.
     * Examples: 'Organization', 'User', 'ExecutionCase', 'SentenceSnapshot',
     *           'Opportunity', 'PieceDraft', 'Filing'.
     */
    entityType: text('entity_type').notNull(),

    /**
     * The UUID of the entity that was acted upon.
     * Stored as text (not UUID FK) to avoid FK constraint failures when
     * acting on entities from future tables not yet in the schema.
     * Callers are responsible for passing valid UUIDs.
     */
    entityId: text('entity_id').notNull(),

    // -------------------------------------------------------------------------
    // Temporal (legal time vs system time)
    // -------------------------------------------------------------------------

    /**
     * When the action occurred, in UTC.
     * For human actions: the server clock at request time.
     * For system/worker actions: the job execution timestamp.
     *
     * This is the SYSTEM time of the action, not the legal effective date of
     * any data within the action. Legal effective dates are stored on the
     * affected entities (occurred_at, effective_from) — not here.
     *
     * Architecture ref: event-state-architecture.md §10.2 (authoritative timestamps).
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------------
    // Change data
    // -------------------------------------------------------------------------

    /**
     * Structured representation of what changed.
     * Schema varies by entity type and action verb. Consumers must not assume
     * a fixed shape — use entity_type + action to determine the expected shape.
     *
     * Common shapes:
     *   - State transition: { previous: "draft", next: "in_review" }
     *   - Creation: { snapshot: { ...entity fields at creation } }
     *   - Confirmation: { snapshot: { ...confirmed entity state } }
     *   - Field update: { fields: { field_name: { previous: X, next: Y } } }
     *
     * Null for actions where no structured change data is applicable
     * (e.g., login events, read-sensitive-field events).
     *
     * Architecture ref: event-state-architecture.md §8.5 (before/after snapshots).
     */
    changes: jsonb('changes'),

    // -------------------------------------------------------------------------
    // Provenance metadata
    // -------------------------------------------------------------------------

    /**
     * Structured provenance metadata linking this audit record into the
     * broader causality chain. Consumers should not assume all fields are present.
     *
     * Known fields:
     *   trigger_event_id    (UUID)  — the domain_event that triggered this action
     *   engine_run_id       (UUID)  — if action was engine-initiated
     *   playbook_version_id (UUID)  — if action applied legal rules
     *   parent_entity_id    (UUID)  — if action was derived from another entity
     *   request_id          (string) — correlation with OpenTelemetry trace
     *   mastra_workflow_id  (string) — if action was inside an AI agent workflow
     *
     * Architecture ref: event-state-architecture.md §8.4 (provenance tracking).
     */
    metadata: jsonb('metadata'),

    // -------------------------------------------------------------------------
    // Request context (for human actions)
    // -------------------------------------------------------------------------

    /**
     * IP address of the requesting client.
     * Stored for security audit purposes. Null for worker/agent actions.
     * LGPD note: IP addresses are personal data. Access to this field is
     * restricted to admin security audits and logged when accessed.
     */
    ipAddress: text('ip_address'),

    /**
     * Session identifier from the auth system.
     * Enables session-level correlation: "show all actions from this session".
     * Null for non-human actors.
     */
    sessionId: text('session_id'),

    /**
     * HTTP request identifier for OpenTelemetry trace correlation.
     * Links the audit entry to the distributed trace for performance and
     * debugging investigation. Null for internal worker actions that
     * do not originate from an HTTP request.
     */
    requestId: text('request_id'),
  },
  (table) => [
    /**
     * Primary query pattern for compliance export:
     * "All actions in org X during time range Y"
     */
    index('audit_logs_org_occurred_idx').on(table.organizationId, table.occurredAt),

    /**
     * Primary query pattern for entity history:
     * "All actions on entity X"
     */
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),

    /**
     * Query pattern for actor attribution:
     * "All actions by actor X in org Y"
     */
    index('audit_logs_actor_idx').on(table.actorType, table.actorId, table.organizationId),
  ]
)

/**
 * AuditLog is intentionally SELECT-only from application code.
 * The Insert type is used exclusively by the audit write helper (src/client/audit.ts).
 * Never import NewAuditLog outside of that helper.
 */
export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
