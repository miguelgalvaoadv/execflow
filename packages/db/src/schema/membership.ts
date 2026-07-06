/**
 * Membership — the join table binding a User to an Organization with a role.
 *
 * This is the authorization boundary: every API request resolves the requesting
 * user's membership in the target organization before any operation proceeds.
 * No membership = no access, regardless of user.status.
 *
 * MVP constraint: one active membership per (user_id, organization_id) pair.
 * A user cannot hold two roles in the same org simultaneously. Multi-role
 * support is a future extension requiring a schema migration.
 *
 * Membership records are soft-suspended, never hard-deleted.
 * When a user leaves an org, their membership is suspended (preserving the audit
 * attribution chain). The user's AuditLog records remain valid and attributed.
 *
 * Architecture ref: functional-architecture.md §1.3 (role hierarchy),
 *                   data-model-v1.md §1 (Membership),
 *                   ARCHITECTURE_RULES.md §M-01 (org-scoped queries).
 */

import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { users } from './user.ts'
import { membershipStatusEnum, membershipRoleEnum } from './_enums.ts'

export const memberships = pgTable(
  'memberships',
  {
    // -------------------------------------------------------------------------
    // Identity (immutable after creation)
    // -------------------------------------------------------------------------

    /** Opaque UUID primary key. */
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Organization this membership belongs to.
     * Immutable after creation — memberships are not transferred between orgs.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * User this membership belongs to.
     * Immutable after creation — memberships are not transferred between users.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    // -------------------------------------------------------------------------
    // Authorization
    // -------------------------------------------------------------------------

    /**
     * Role within this organization.
     * Permission hierarchy: admin > lawyer > assistant.
     *
     * Role is mutable (admin may promote/demote members) but every change
     * produces an AuditLog entry. Role changes are not retroactive —
     * historical AuditLog entries preserve the role at time of action.
     *
     * Architecture ref: functional-architecture.md §1 (roles),
     *                   ARCHITECTURE_RULES.md §S-01 (transitions audited).
     */
    role: membershipRoleEnum('role').notNull(),

    /**
     * Para memberships com role='client': aponta o registro de Client cujos
     * dados este usuário pode ver no PORTAL restrito. NULL para staff.
     * O portal resolve TUDO a partir deste vínculo — um usuário-cliente sem
     * linked_client_id não vê nada.
     * FK sem referência circular: clients importa users, então aqui a FK é
     * criada na migração (0011), não via .references().
     */
    linkedClientId: uuid('linked_client_id'),

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Membership status.
     * Transitions: invited → active → suspended.
     * Suspended memberships retain the record for attribution history.
     */
    status: membershipStatusEnum('status').notNull().default('invited'),

    // -------------------------------------------------------------------------
    // Invitation metadata
    // -------------------------------------------------------------------------

    /**
     * Who sent the invitation. Nullable for initial org owner (self-bootstrap).
     * Retained permanently for org governance traceability.
     */
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),

    /**
     * When the invitation was sent.
     * SLA tracking: invitations older than org.settings.invite_expiry_days
     * are considered expired at the application layer (no DB enforcement —
     * the business rule may change without a migration).
     */
    invitedAt: timestamp('invited_at', { withTimezone: true }),

    /**
     * When the user accepted the invitation and activated the membership.
     * Null until the invite is accepted.
     */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),

    /**
     * When the membership was suspended, if ever.
     * Null for active memberships.
     */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),

    /**
     * Why the membership was suspended. Required when suspended_at is set.
     * Free text stored by the admin who performed the suspension.
     */
    suspensionReason: text('suspension_reason'),

    // -------------------------------------------------------------------------
    // Timestamps
    // -------------------------------------------------------------------------

    /** When this membership record was created. Immutable. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Last time any mutable field on this record was updated. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Enforce one active membership per (user, org) pair.
     * The unique index covers all statuses — if a suspended membership exists,
     * re-inviting requires reactivating the existing record, not creating a new one.
     * This prevents ghost membership accumulation.
     */
    uniqueIndex('memberships_org_user_unique').on(table.organizationId, table.userId),
  ]
)

export type Membership = typeof memberships.$inferSelect
export type NewMembership = typeof memberships.$inferInsert
