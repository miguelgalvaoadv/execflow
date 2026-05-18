/**
 * RBAC middleware guards — role-based access control for API routes.
 *
 * These are ROUTE-LEVEL guards that enforce minimum role requirements.
 * They must run AFTER both authMiddleware and orgMiddleware.
 *
 * Route-level RBAC vs service-level RBAC:
 * - Route guards reject requests before they reach service logic.
 *   Use for: "this entire route group is lawyer-only."
 * - Service-level checks (lib/permissions.ts) enforce per-operation rules.
 *   Use for: "creating a case is OK, but approving a snapshot requires lawyer."
 *
 * Both layers are enforced. The route guard is the outer gate; the service
 * check is the inner gate for operations that have finer-grained requirements.
 *
 * Apply after both auth and org middleware:
 *   app.use('/api/v1/playbooks/*', authMiddleware, orgMiddleware, requireMinRole('lawyer'))
 *   app.use('/api/v1/admin/*', authMiddleware, orgMiddleware, requireRole('admin'))
 *
 * Architecture ref: functional-architecture.md §5 (permissions),
 *                   ARCHITECTURE_RULES.md §F-01 (no auth in frontend).
 */

import type { MiddlewareHandler } from 'hono'
import { forbidden } from '../lib/respond.ts'
import { hasMinRole, hasExactRole } from '../lib/permissions.ts'
import type { HonoVariables } from '../context/types.ts'
import type { MembershipRole } from '@execflow/db/types'

/**
 * Require the actor to hold AT LEAST the specified role.
 * Admin has all lawyer permissions; lawyer has all assistant permissions.
 *
 * @example
 * app.use('/api/v1/snapshots/:id/confirm', requireMinRole('lawyer'))
 */
export function requireMinRole(
  minRole: MembershipRole
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const org = c.get('org')

    if (!org) {
      return forbidden(c, 'Organization context required.')
    }

    if (!hasMinRole(org.role, minRole)) {
      return forbidden(
        c,
        `This action requires at least the '${minRole}' role in this organization.`
      )
    }

    await next()
  }
}

/**
 * Require the actor to hold EXACTLY the specified role.
 * Use this for admin-only operations that should not be delegable.
 *
 * @example
 * app.use('/api/v1/members/*', requireRole('admin'))
 */
export function requireRole(
  role: MembershipRole
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const org = c.get('org')

    if (!org) {
      return forbidden(c, 'Organization context required.')
    }

    if (!hasExactRole(org.role, role)) {
      return forbidden(
        c,
        `This action requires the '${role}' role in this organization.`
      )
    }

    await next()
  }
}

/**
 * Convenience guard: lawyer or admin only.
 * Most legal approval actions require this level.
 */
export const requireLawyer = requireMinRole('lawyer')

/**
 * Convenience guard: admin only.
 * Org management, playbook publishing, member management.
 */
export const requireAdmin = requireRole('admin')
