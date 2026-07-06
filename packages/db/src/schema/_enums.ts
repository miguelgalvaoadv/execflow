/**
 * PostgreSQL enum types shared across the EXECFLOW schema.
 *
 * Design rules:
 * - Enums enforce valid status values at the database level.
 * - Enum names are snake_case, matching the PostgreSQL convention.
 * - Never use raw text columns for status fields — use these enums.
 * - Adding values to an existing enum requires a migration (no removals — removing
 *   would break historical records that carry the old value).
 *
 * Architecture reference: event-state-architecture.md §3 (state machine discipline)
 */

import { pgEnum } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

/**
 * Organization lifecycle states.
 * Transitions: active ↔ suspended; active → deactivated (terminal).
 * Deactivated organizations retain all data for legal traceability.
 */
export const organizationStatusEnum = pgEnum('organization_status', [
  'active',
  'suspended',
  'deactivated',
])

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

/**
 * User account lifecycle states.
 * Transitions: invited → active → suspended | deactivated.
 * Users with attribution history are NEVER hard-deleted.
 * Architecture ref: data-model-v1.md §2.1
 */
export const userStatusEnum = pgEnum('user_status', [
  'active',
  'invited',
  'suspended',
  'deactivated',
])

// ---------------------------------------------------------------------------
// Membership (User ↔ Organization)
// ---------------------------------------------------------------------------

/**
 * Membership invitation/activation lifecycle.
 * Distinct from user status — a user may be active globally
 * but have a suspended membership in a specific organization.
 */
export const membershipStatusEnum = pgEnum('membership_status', [
  'active',
  'invited',
  'suspended',
])

/**
 * Role within an organization.
 * Roles are org-scoped — a user may hold different roles in different orgs.
 * MVP: one role per (user, organization) pair.
 * Architecture ref: functional-architecture.md §1, data-model-v1.md §1 (Membership)
 *
 * Permission hierarchy: admin > lawyer > assistant > client
 * Agents (agent.ingestion, agent.analysis, etc.) are NOT membership roles —
 * they are actor types tracked in audit records, not human org members.
 *
 * 'client' — cliente do escritório com acesso APENAS ao portal restrito
 * (spec §17). Todas as rotas operacionais internas exigem no mínimo
 * 'assistant', então o client é estruturalmente bloqueado delas. O vínculo
 * com o registro Client é memberships.linked_client_id.
 */
export const membershipRoleEnum = pgEnum('membership_role', [
  'admin',
  'lawyer',
  'assistant',
  'client',
])

// ---------------------------------------------------------------------------
// Actor (for AuditLog and DomainEvent attribution)
// ---------------------------------------------------------------------------

/**
 * Types of actors that can initiate actions in EXECFLOW.
 *
 * Human actors authenticate via the auth system and carry a user_id.
 * AI agent actors are identified by agent instance IDs; they never hold
 * membership roles and can never approve, file, or confirm legal state.
 *
 * 'admin_impersonating': admin acting as another user for support purposes.
 * This type is tracked separately so impersonated actions are never
 * misattributed to the target user. Architecture ref: AI_BOUNDARIES.md,
 * technical-stack-decision.md §5.1 (Better Auth impersonation audit).
 */
export const actorTypeEnum = pgEnum('actor_type', [
  'user',
  'agent_ingestion',
  'agent_analysis',
  'agent_drafting',
  'agent_notification',
  'system',
  'admin_impersonating',
])

// ---------------------------------------------------------------------------
// DomainEvent (event outbox / processing pipeline)
// ---------------------------------------------------------------------------

/**
 * Processing state of a domain event in the outbox pipeline.
 *
 * pending       → written in same transaction as the originating state change;
 *                 not yet picked up by the relay worker.
 * published     → outbox relay has published to the job queue (pg-boss);
 *                 consumers may now process.
 * failed        → relay or consumer reported an error; retry will be attempted.
 * dead_lettered → max retries exceeded; requires human inspection.
 *
 * Architecture ref: event-state-architecture.md §2.7 (transactional outbox),
 *                   event-state-architecture.md §4.5 (dead-letter handling).
 */
export const eventProcessingStatusEnum = pgEnum('event_processing_status', [
  'pending',
  'published',
  'failed',
  'dead_lettered',
])
