/**
 * Hono request context types for EXECFLOW API.
 *
 * Every authenticated API request carries a typed context object that is
 * populated by the middleware chain and consumed by route handlers.
 * The context is the single source of truth for:
 * - Who is making the request (actor)
 * - Which organization they are operating within (tenant)
 * - What role they hold (authorization)
 *
 * Middleware execution order (enforced in app.ts):
 *   1. authMiddleware    → populates auth, actor
 *   2. orgMiddleware     → populates org, membership, role
 *   3. [route handlers]  → read from context, never re-resolve
 *
 * Architecture ref: ARCHITECTURE_RULES.md §F-05 (all routes authenticated),
 *                   §M-01 (every query organization-scoped),
 *                   technical-stack-decision.md §2.1 (Hono rationale).
 */

import type { Context } from 'hono'
import type { RequestActor, SessionUser, SessionData } from '@execflow/auth/types'
import type { Organization, Membership, MembershipRole } from '@execflow/db/types'

/**
 * Auth context — populated by authMiddleware.
 * Available on all routes under /api/v1/** after auth middleware runs.
 */
export type AuthContext = {
  /**
   * The authenticated user's ba_user fields from Better Auth's session resolution.
   * Use this for auth-layer decisions (email verified? banned?).
   */
  sessionUser: SessionUser

  /**
   * The raw Better Auth session record.
   * Use this to read session metadata (expiresAt, ipAddress, impersonatedBy).
   */
  session: SessionData

  /**
   * Attribution context for AuditLog writes within this request.
   * Always use this — never construct actorId manually in route handlers.
   * Built by lib/actor.ts based on session + impersonation state.
   */
  actor: RequestActor
}

/**
 * Organization context — populated by orgMiddleware.
 * Available on routes under /api/v1/** after org middleware runs.
 * Null values indicate the user has no valid org context for this request.
 */
export type OrgContext = {
  /**
   * The active organization from our organizations table.
   * Resolved from X-Organization-Id header (primary) or session.activeOrganizationId.
   * Validated: organization exists, is active (status='active'), user is a member.
   */
  organization: Organization

  /**
   * The user's membership record in the active organization.
   * Contains: role, status, invitedAt, acceptedAt.
   * Status is always 'active' at this point (suspended memberships are rejected).
   */
  membership: Membership

  /**
   * The user's role in the active organization.
   * Shortcut for membership.role — provided for convenience in RBAC guards.
   * Values: 'admin' | 'lawyer' | 'assistant'
   */
  role: MembershipRole

  /**
   * The domain users record for the authenticated user.
   * This is the attribution-canonical identity (same UUID as sessionUser.id).
   * Use this for FK references in AuditLog, business entity creates, etc.
   */
  domainUserId: string
}

/**
 * Hono variable bag type.
 * Declare this as the generic parameter when creating Hono instances:
 *   const app = new Hono<{ Variables: HonoVariables }>()
 */
export type HonoVariables = {
  /** Auth context. Set by authMiddleware. Present on all authenticated routes. */
  auth: AuthContext

  /**
   * Organization context. Set by orgMiddleware.
   * Only present on routes that pass orgMiddleware.
   */
  org: OrgContext
}

/**
 * Fully-typed Hono Context for route handlers that have passed both middlewares.
 * Destructuring convenience:
 *   const { auth, org } = getTypedContext(c)
 */
export type HonoContext = Context<{ Variables: HonoVariables }>

/**
 * Extract the typed context variables from a Hono Context.
 * Use in route handlers to access auth and org with full type safety.
 */
export function getTypedContext(c: HonoContext) {
  return {
    auth: c.get('auth'),
    org: c.get('org'),
  }
}
