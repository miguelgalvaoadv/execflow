/**
 * Shared auth types exported from packages/auth.
 * Used by apps/api middleware and future packages that need auth primitives.
 *
 * These types describe the resolved auth context available after
 * Better Auth's getSession() validates an incoming request.
 */

import type { Auth } from './config.ts'

/**
 * The raw Better Auth session result.
 * Returned by auth.api.getSession({ headers }).
 * Null if no valid session exists.
 */
export type SessionResult = Awaited<ReturnType<Auth['api']['getSession']>>

/**
 * The user object from a resolved session.
 */
export type SessionUser = NonNullable<SessionResult>['user']

/**
 * The session object from a resolved session.
 * Contains the raw session record (expiresAt, token, userId, impersonatedBy, etc.)
 */
export type SessionData = NonNullable<SessionResult>['session']

/**
 * Resolved actor context for a single request.
 *
 * This is built by apps/api/src/lib/actor.ts from the validated session
 * and is used as the attribution source for ALL AuditLog writes within
 * the same request lifecycle.
 *
 * Architecture ref: event-state-architecture.md §8.2 (actor attribution),
 *                   AI_BOUNDARIES.md (human vs AI attribution).
 */
export type RequestActor = {
  /**
   * Actor type, matching the actorTypeEnum values from packages/db.
   * For human requests: always 'user' or 'admin_impersonating'.
   */
  actorType: 'user' | 'admin_impersonating'

  /**
   * The ID of the actor responsible for this action.
   *
   * For 'user': the authenticated user's ba_user.id (= users.id UUID as string).
   * For 'admin_impersonating': the ADMIN's ba_user.id — NOT the impersonated user.
   *
   * Architecture ref: ARCHITECTURE_RULES.md §F-05.
   * "Impersonated actions are NEVER attributed to the target user."
   */
  actorId: string

  /**
   * The role of the actor within the active organization.
   * Null if the actor has no active organization context on this request.
   */
  actorRole: string | null

  /**
   * Set when actorType='admin_impersonating'.
   * The UUID of the user being impersonated (the session's effective user).
   * This is ONLY for record-keeping — attribution always goes to actorId (the admin).
   */
  impersonatingUserId: string | null

  /**
   * The session token, for AuditLog sessionId attribution.
   */
  sessionToken: string

  /**
   * The request's IP address, if available.
   */
  ipAddress: string | null
}
