/**
 * WriteContext — the canonical context object for all domain service calls.
 *
 * Every write operation in EXECFLOW (case creation, document registration,
 * timeline events, etc.) must be called with a WriteContext. This ensures:
 * 1. Actor attribution is never lost between HTTP boundary and database write.
 * 2. Correlation/causation IDs propagate correctly for event chain tracing.
 * 3. Organization isolation is enforced at every service call site.
 *
 * USAGE PATTERN:
 *   // In a route handler:
 *   const ctx = buildWriteContext(c)
 *   const result = await createClient(ctx, input)
 *
 * PROPAGATION RULE (critical for event chains):
 * When a service call produces a DomainEvent, and that event triggers another
 * action, the child action's WriteContext must have:
 *   - causationId = the parent DomainEvent.id
 *   - correlationId = the SAME correlationId as the parent context
 *
 * Never generate a new correlationId for a derived operation — that breaks
 * the causality chain traversal.
 * Architecture ref: event-state-architecture.md §1.6 (explicit causality chains).
 */

import type { DbClient } from './db.ts'
import type { RequestActor } from '@execflow/auth/types'
import type { HonoContext } from '../context/types.ts'
import { buildActor } from './actor.ts'

/**
 * The context object passed to all domain service functions.
 * Services are pure functions that take this context + domain input.
 * Services never access HTTP context (Hono, headers, cookies) directly.
 */
export type WriteContext = {
  /** The Drizzle database client. Services use this to open transactions. */
  db: DbClient

  /**
   * The attribution context for audit and event records.
   * Built from the validated session + org context by buildWriteContext().
   * Never constructed manually in route handlers.
   */
  actor: RequestActor

  /**
   * The active organization ID. Validated by orgMiddleware.
   * All repository calls include this as the first filter.
   * ARCHITECTURE_RULES.md §M-01.
   */
  organizationId: string

  /**
   * Domain user ID of the authenticated user.
   * Use for FK references in entities (created_by_user_id, responsible_lawyer_user_id, etc.)
   * This is the EXECFLOW users.id, not Better Auth ba_user.id (they share the same UUID value).
   */
  userId: string

  /**
   * OpenTelemetry trace / request correlation ID.
   * Used in AuditLog.requestId and DomainEvent.metadata.requestId.
   * Set from X-Request-Id header (or generated at middleware layer).
   */
  requestId: string

  /**
   * Logical operation correlation ID.
   * Shared across all events produced by one HTTP request or job run.
   * Used to answer: "what happened as part of operation X?"
   * Architecture ref: event-state-architecture.md §1.6.
   *
   * For HTTP requests: derived from requestId (same value).
   * For async/derived operations: propagated from the parent event's correlationId.
   */
  correlationId: string
}

/**
 * Build a WriteContext from a fully authenticated and org-resolved Hono context.
 * Call this at the START of a route handler that delegates to domain services.
 *
 * Requires both authMiddleware and orgMiddleware to have already run.
 */
export function buildWriteContext(c: HonoContext, db: DbClient): WriteContext {
  const auth = c.get('auth')
  const org = c.get('org')

  const actor = buildActor(auth, org)

  const requestId =
    c.res.headers.get('X-Request-Id') ??
    c.req.header('X-Request-Id') ??
    crypto.randomUUID()

  return {
    db,
    actor,
    organizationId: org.organization.id,
    userId: org.domainUserId,
    requestId,
    correlationId: requestId,
  }
}

/**
 * Create a child WriteContext for operations that are CAUSED BY a prior DomainEvent.
 * Preserves the correlationId but sets a new causationId.
 *
 * Use this when a service operation triggers a downstream operation
 * (e.g., confirming a document triggers a timeline event insertion).
 */
export function deriveWriteContext(
  parent: WriteContext,
  causationEventId: string
): WriteContext & { causationId: string } {
  return {
    ...parent,
    correlationId: parent.correlationId,
    causationId: causationEventId,
  }
}
