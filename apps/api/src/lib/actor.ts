/**
 * Actor attribution builder for AuditLog writes.
 *
 * PURPOSE:
 * Every AuditLog entry requires precise actor attribution: WHO performed the action,
 * under what circumstances (impersonation?), with what role.
 *
 * This module is the SINGLE PLACE where actor attribution is constructed.
 * Route handlers and service functions never build RequestActor directly —
 * they call buildActor() from the request context.
 *
 * IMPERSONATION SAFETY (critical):
 * When an admin impersonates a user:
 * - The session's effective user = the IMPERSONATED user
 * - session.impersonatedBy = the ADMIN who started impersonation
 *
 * Attribution MUST go to the ADMIN (actorId = impersonatedBy), not the impersonated user.
 * This is enforced here and in the AuditLog schema comments.
 *
 * Architecture ref: technical-stack-decision.md §5.1 (impersonation safety model),
 *                   event-state-architecture.md §8.2 (actor attribution),
 *                   AI_BOUNDARIES.md (human vs AI attribution).
 */

import type { RequestActor } from '@execflow/auth/types'
import type { AuthContext, OrgContext } from '../context/types.ts'

/**
 * Build a RequestActor from the resolved auth context.
 * Call this at the start of any service function that writes to AuditLog.
 *
 * @param auth - The auth context populated by authMiddleware
 * @param org  - The org context populated by orgMiddleware (optional for org-scoped actions)
 * @returns    A RequestActor ready for use in AuditLog inserts
 *
 * @example
 * const actor = buildActor(c.get('auth'), c.get('org'))
 * await db.insert(auditLogs).values({
 *   actorType: actor.actorType,
 *   actorId: actor.actorId,
 *   actorRole: actor.actorRole,
 *   impersonatingUserId: actor.impersonatingUserId,
 *   ...
 * })
 */
export function buildActor(
  auth: AuthContext,
  org?: OrgContext
): RequestActor {
  const { session, sessionUser } = auth

  const isImpersonating =
    'impersonatedBy' in session &&
    session.impersonatedBy != null &&
    typeof session.impersonatedBy === 'string'

  if (isImpersonating) {
    const adminId = session.impersonatedBy as string

    return {
      actorType: 'admin_impersonating',
      /**
       * The ADMIN is the actor. Actions are attributed to the admin who is impersonating,
       * never to the impersonated user (session.userId / sessionUser.id).
       */
      actorId: adminId,
      actorRole: org?.role ?? null,
      /**
       * Record who is being impersonated for the audit trail.
       * This field is informational — it is NOT the actor.
       */
      impersonatingUserId: sessionUser.id,
      sessionToken: session.token,
      ipAddress: session.ipAddress ?? null,
    }
  }

  return {
    actorType: 'user',
    actorId: sessionUser.id,
    actorRole: org?.role ?? null,
    impersonatingUserId: null,
    sessionToken: session.token,
    ipAddress: session.ipAddress ?? null,
  }
}

/**
 * Build a RequestActor for auth-level events (sign-in, sign-out) where the full
 * auth + org context is not yet available. Used in auth route handlers.
 *
 * @param userId  - Better Auth user ID (ba_user.id)
 * @param sessionToken - Session token
 * @param ipAddress - Client IP, if available
 */
export function buildAuthActor(
  userId: string,
  sessionToken: string,
  ipAddress?: string | null
): RequestActor {
  return {
    actorType: 'user',
    actorId: userId,
    actorRole: null,
    impersonatingUserId: null,
    sessionToken,
    ipAddress: ipAddress ?? null,
  }
}
