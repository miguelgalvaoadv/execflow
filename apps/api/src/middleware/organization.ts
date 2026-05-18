/**
 * Organization middleware — tenant resolution and membership validation.
 *
 * This is the tenant isolation enforcement point. Every request to an
 * org-scoped route must pass through this middleware AFTER authMiddleware.
 *
 * RESOLUTION STRATEGY:
 * 1. Read org ID from X-Organization-Id request header (primary).
 * 2. Fall back to session.activeOrganizationId if header is not present.
 * 3. If neither is set → 400 Bad Request (org context is required).
 * 4. Validate the org exists and is active.
 * 5. Validate the user has an active membership in that org.
 * 6. Populate c.set('org', OrgContext).
 *
 * ISOLATION GUARANTEE:
 * After this middleware runs, the org context is validated server-side.
 * All downstream route handlers use c.get('org').organization.id for
 * database queries — never trust any user-supplied org ID directly.
 *
 * ROLE UPDATE:
 * After membership is resolved, the actor's role in the audit context
 * is updated to reflect the org-specific role. AuditLog entries written
 * after this point carry the correct actorRole.
 *
 * Apply AFTER authMiddleware on org-scoped routes:
 *   app.use('/api/v1/cases/*', authMiddleware, orgMiddleware)
 *   app.use('/api/v1/clients/*', authMiddleware, orgMiddleware)
 *
 * Architecture ref: ARCHITECTURE_RULES.md §M-01 (every query org-scoped),
 *                   §M-02 (no cross-org data references).
 */

import type { MiddlewareHandler } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import { unauthorized, forbidden, unprocessable, internalError } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'
import { organizations, memberships, users } from '@execflow/db/schema'

export const orgMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const auth = c.get('auth')

  if (!auth) {
    // authMiddleware must run before orgMiddleware
    return unauthorized(c)
  }

  // -------------------------------------------------------------------------
  // Step 1: Determine the target organization ID
  // -------------------------------------------------------------------------

  const headerOrgId = c.req.header('X-Organization-Id')
  const sessionOrgId = auth.session.activeOrganizationId ?? null

  const targetOrgId = headerOrgId ?? sessionOrgId

  if (!targetOrgId) {
    return unprocessable(
      c,
      'Organization context is required. Set the X-Organization-Id header.'
    )
  }

  // -------------------------------------------------------------------------
  // Step 2: Validate organization exists and is active
  // -------------------------------------------------------------------------

  let organization
  try {
    organization = await db.query.organizations.findFirst({
      where: eq(organizations.id, targetOrgId),
    })
  } catch (err) {
    return internalError(c, err)
  }

  if (!organization) {
    // Return 403 (not 404) — do not reveal whether the org exists to non-members.
    // Architecture ref: ARCHITECTURE_RULES.md §M-01.
    return forbidden(c, 'Access denied to the requested organization.')
  }

  if (organization.status !== 'active') {
    return forbidden(
      c,
      organization.status === 'suspended'
        ? 'This organization account is temporarily suspended.'
        : 'This organization account is no longer active.'
    )
  }

  // -------------------------------------------------------------------------
  // Step 3: Validate user membership in the organization
  // -------------------------------------------------------------------------

  const userId = auth.sessionUser.id

  let membership
  try {
    membership = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.organizationId, targetOrgId),
        eq(memberships.userId, userId)
      ),
    })
  } catch (err) {
    return internalError(c, err)
  }

  if (!membership) {
    return forbidden(c, 'You are not a member of this organization.')
  }

  if (membership.status !== 'active') {
    return forbidden(
      c,
      membership.status === 'suspended'
        ? 'Your membership in this organization has been suspended.'
        : 'Your invitation to this organization has not been accepted yet.'
    )
  }

  // -------------------------------------------------------------------------
  // Step 4: Resolve domain user record
  // -------------------------------------------------------------------------

  let domainUser
  try {
    domainUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })
  } catch (err) {
    return internalError(c, err)
  }

  if (!domainUser) {
    /**
     * Edge case: ba_user exists (session is valid) but users record does not.
     * This can happen if the databaseHooks.user.create.after hook in packages/auth
     * failed silently. Recovery: the next sign-in will retry the sync.
     * For now: treat as unauthorized to force re-authentication.
     */
    console.error(
      `[org-middleware] Domain user record missing for authenticated user ${userId}. ` +
      'Auth/domain sync may have failed. Check packages/auth databaseHooks.'
    )
    return unauthorized(c, 'User account setup is incomplete. Please sign in again.')
  }

  // -------------------------------------------------------------------------
  // Step 5: Populate org context + update actor role
  // -------------------------------------------------------------------------

  const role = membership.role

  c.set('org', {
    organization,
    membership,
    role,
    domainUserId: domainUser.id,
  })

  // Update the actor's role in the auth context now that membership is resolved.
  // This ensures AuditLog entries written after this point carry the correct role.
  const currentAuth = c.get('auth')
  c.set('auth', {
    ...currentAuth,
    actor: {
      ...currentAuth.actor,
      actorRole: role,
    },
  })

  await next()
}
