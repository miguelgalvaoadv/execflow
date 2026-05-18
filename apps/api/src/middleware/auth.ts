/**
 * Auth middleware — session validation and actor context.
 *
 * Validates the incoming session cookie via Better Auth's getSession().
 * On success: populates c.set('auth', AuthContext) and continues.
 * On failure: returns 401 Unauthorized.
 *
 * IMPERSONATION DETECTION:
 * When session.impersonatedBy is set, the request is an impersonated session.
 * The actor context is built with actorType='admin_impersonating' so that
 * ALL downstream AuditLog writes correctly attribute to the admin, not the
 * impersonated user.
 *
 * BANNED USER HANDLING:
 * Better Auth rejects session creation for banned users (via admin plugin).
 * If a user is banned after their session was created, Better Auth invalidates
 * existing sessions on the next request via the session validation check.
 *
 * Apply this middleware to all routes under /api/v1/**:
 *   app.use('/api/v1/*', authMiddleware)
 *
 * Architecture ref: ARCHITECTURE_RULES.md §F-05 (no unauthenticated routes),
 *                   technical-stack-decision.md §5.1 (Better Auth).
 */

import type { MiddlewareHandler } from 'hono'
import { auth } from '../lib/auth.ts'
import { buildActor } from '../lib/actor.ts'
import { unauthorized, forbidden } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  // Resolve session from the incoming request headers (cookie-based).
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session) {
    return unauthorized(c)
  }

  // Better Auth admin plugin: check if the user account is banned.
  // While Better Auth should reject session creation for banned users,
  // we double-check here for defense-in-depth.
  if (session.user.banned === true) {
    const banExpires = session.user.banExpires
    const isExpired = banExpires != null && banExpires < new Date()

    if (!isExpired) {
      return forbidden(c, 'This account has been suspended.')
    }
    // If ban is expired, Better Auth should have already cleared it.
    // Allow through and let Better Auth handle the state on next update.
  }

  // Build the actor attribution context for this request.
  // This is used by all AuditLog writes downstream.
  const actor = buildActor({
    sessionUser: session.user,
    session: session.session,
    actor: null as never, // populated below
  })

  c.set('auth', {
    sessionUser: session.user,
    session: session.session,
    actor: {
      ...actor,
      // Override: re-build with correct reference now that we have the full struct
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorRole: null, // populated by orgMiddleware after membership resolution
      impersonatingUserId: actor.impersonatingUserId,
      sessionToken: actor.sessionToken,
      ipAddress: actor.ipAddress,
    },
  })

  await next()
}
