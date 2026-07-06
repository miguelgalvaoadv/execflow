/**
 * Permission primitives for EXECFLOW API.
 *
 * Permission model:
 * - Roles are org-scoped: admin > lawyer > assistant
 * - No cross-org permission checks (ARCHITECTURE_RULES.md §M-01)
 * - The frontend enforces NOTHING — all permission checks are server-side
 * - Permission checks are colocated with business logic in service layer
 *   (not scattered across route handlers)
 *
 * These helpers are used in:
 * - rbac.ts middleware (route-level guards)
 * - service functions (entity-operation guards)
 *
 * Architecture ref: functional-architecture.md §5 (permissions and ownership),
 *                   ARCHITECTURE_RULES.md §F-01 (no business logic in frontend).
 */

import type { MembershipRole } from '@execflow/db/types'

/**
 * Role hierarchy values for comparison.
 * Higher number = more permissions.
 */
const ROLE_HIERARCHY: Record<MembershipRole, number> = {
  client: 0, // portal do cliente — abaixo de TODO acesso operacional interno
  assistant: 1,
  lawyer: 2,
  admin: 3,
}

/**
 * Returns true if the actor's role meets or exceeds the required minimum role.
 *
 * @example
 * hasMinRole('lawyer', 'lawyer') → true
 * hasMinRole('assistant', 'lawyer') → false
 * hasMinRole('admin', 'lawyer') → true (admin has all lawyer permissions)
 */
export function hasMinRole(
  actorRole: MembershipRole,
  required: MembershipRole
): boolean {
  return ROLE_HIERARCHY[actorRole] >= ROLE_HIERARCHY[required]
}

/** Narrows session actor role to org membership role, or null if absent/invalid. */
export function resolveMembershipRole(actorRole: string | null): MembershipRole | null {
  if (
    actorRole === 'admin' ||
    actorRole === 'lawyer' ||
    actorRole === 'assistant' ||
    actorRole === 'client'
  ) {
    return actorRole
  }
  return null
}

/**
 * Returns true if the actor holds exactly the specified role.
 * Use hasMinRole() for most permission checks (it handles role hierarchy).
 * Use hasExactRole() when a permission is EXCLUSIVE to one role.
 */
export function hasExactRole(
  actorRole: MembershipRole,
  required: MembershipRole
): boolean {
  return actorRole === required
}

/**
 * Returns true if the actor is an org admin.
 */
export function isOrgAdmin(actorRole: MembershipRole): boolean {
  return actorRole === 'admin'
}

/**
 * Returns true if the actor is a lawyer (or higher).
 * Required for: approving pieces, confirming snapshots, qualifying opportunities.
 * Architecture ref: functional-architecture.md §5.2 (lawyer authority boundaries).
 */
export function canApprove(actorRole: MembershipRole): boolean {
  return hasMinRole(actorRole, 'lawyer')
}

/**
 * Returns true if the actor can view case details.
 * All roles have read access to cases in their organization.
 * Sensitive fields (CPF, contact) are filtered separately.
 */
export function canViewCases(actorRole: MembershipRole): boolean {
  return hasMinRole(actorRole, 'assistant')
}

/**
 * Returns true if the actor can create or modify operational records
 * (deadline notes, visit notes, document associations).
 * Assistants can prepare; lawyers and admins can finalize.
 */
export function canWrite(actorRole: MembershipRole): boolean {
  return hasMinRole(actorRole, 'assistant')
}

/**
 * Returns true if the actor can publish playbook versions.
 * Requires dual human review: only lawyers or admins may publish.
 * Architecture ref: playbook-system.md §6 (safety and governance).
 */
export function canPublishPlaybook(actorRole: MembershipRole): boolean {
  return hasMinRole(actorRole, 'lawyer')
}

/**
 * Returns true if the actor can manage org members (invite, suspend, change roles).
 * Only org admins can manage membership.
 */
export function canManageMembers(actorRole: MembershipRole): boolean {
  return isOrgAdmin(actorRole)
}

/**
 * Returns true if the actor can access LGPD-sensitive fields.
 * Sensitive field access requires lawyer or admin role and is always audited.
 * Architecture ref: ENGINEERING_PRINCIPLES.md §5 (auditability by default).
 */
export function canAccessSensitiveData(actorRole: MembershipRole): boolean {
  return hasMinRole(actorRole, 'lawyer')
}
