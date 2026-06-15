/**
 * Auth routes — Better Auth handler mount + session management extensions.
 *
 * CORE ROUTES (delegated to Better Auth):
 * Mounted at /api/auth/** — Better Auth handles all auth protocol requests.
 *
 * EXTENSION ROUTES (EXECFLOW-specific):
 *
 * PUT  /api/v1/me/session/active-organization
 *   Sets the active organization for the session (for frontend state restoration).
 *   Validates the user is a member of the requested org before setting.
 *   Protected: requires auth.
 *
 * GET  /api/v1/me
 *   Returns the current user + active org + role.
 *   Used by the frontend on app load to restore user context.
 *   Protected: requires auth + org.
 *
 * Architecture ref: technical-stack-decision.md §5.1 (Better Auth),
 *                   ux-flow-architecture.md §8 (search and retrieval — recent-work continuity).
 */

import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { authHandler } from '../lib/auth.ts'
import { db } from '../lib/db.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { forbidden, unprocessable, internalError } from '../lib/respond.ts'
import { memberships, authSessions, organizations } from '@execflow/db/schema'
import type { HonoVariables } from '../context/types.ts'

const authRouter = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// Better Auth core handler — delegates all auth protocol requests
// -------------------------------------------------------------------------

authRouter.on(['GET', 'POST'], '/auth/**', authHandler)

// -------------------------------------------------------------------------
// Session active-org management
// -------------------------------------------------------------------------

authRouter.put(
  '/v1/me/session/active-organization',
  authMiddleware,
  async (c) => {
    const { sessionUser, session } = c.get('auth')

    let body: { organizationId?: unknown }
    try {
      body = await c.req.json<{ organizationId?: unknown }>()
    } catch {
      return unprocessable(c, 'Request body must be JSON with organizationId.')
    }

    const orgId = body.organizationId
    if (typeof orgId !== 'string' || orgId.trim() === '') {
      return unprocessable(c, 'organizationId must be a non-empty string.')
    }

    // Validate the user is an active member of the requested org.
    let membership
    try {
      membership = await db.query.memberships.findFirst({
        where: and(
          eq(memberships.organizationId, orgId),
          eq(memberships.userId, sessionUser.id)
        ),
      })
    } catch (err) {
      return internalError(c, err)
    }

    if (!membership || membership.status !== 'active') {
      return forbidden(c, 'You are not an active member of the requested organization.')
    }

    // Update the session's active org.
    try {
      await db
        .update(authSessions)
        .set({ activeOrganizationId: orgId })
        .where(eq(authSessions.id, session.id))
    } catch (err) {
      return internalError(c, err)
    }

    return c.json({ success: true, activeOrganizationId: orgId })
  }
)

// -------------------------------------------------------------------------
// Current user + org context
// -------------------------------------------------------------------------

authRouter.get(
  '/v1/me',
  authMiddleware,
  async (c) => {
    const { sessionUser, session } = c.get('auth')

    // 1. Determine target org (from session or get first active membership)
    let orgId = session.activeOrganizationId

    let membership
    let organization
    try {
      if (orgId) {
        const mems = await db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, orgId),
              eq(memberships.userId, sessionUser.id),
              eq(memberships.status, 'active')
            )
          )
          .limit(1)
        membership = mems[0]
      }

      if (!membership) {
        // Fallback to the first active membership
        const mems = await db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, sessionUser.id),
              eq(memberships.status, 'active')
            )
          )
          .limit(1)
        membership = mems[0]
      }

      if (membership) {
        const orgs = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, membership.organizationId))
          .limit(1)
        organization = orgs[0]
      }
    } catch (err) {
      return internalError(c, err)
    }

    if (!membership || !organization) {
      return forbidden(c, 'User has no active organization memberships.')
    }
    const role = membership.role

    return c.json({
      user: {
        id: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
        emailVerified: sessionUser.emailVerified,
        image: sessionUser.image ?? null,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        timezone: organization.timezone,
      },
      role,
    })
  }
)

export { authRouter }
