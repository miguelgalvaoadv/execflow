/**
 * User — authenticated human actor in EXECFLOW.
 *
 * Users are platform-level, not org-level. A single user account may hold
 * membership in multiple organizations with different roles in each.
 * The Membership table (membership.ts) is the join table.
 *
 * Users with legal attribution history (AuditLog rows referencing their id,
 * SentenceSnapshot.confirmed_by_user_id, Filing approvals, etc.) are NEVER
 * hard-deleted. Deactivation via status + deactivated_at is the only exit path.
 *
 * Auth integration: Better Auth manages session, password hashing, and OAuth
 * tokens. The users table here stores application-level identity and attribution
 * data. The auth provider syncs the user record on login.
 * Architecture ref: data-model-v1.md §2.1, technical-stack-decision.md §5.1.
 *
 * Sensitive fields: email is PII under LGPD. bar_number is professional identifier.
 * Access logging applies to reads of this record in sensitive contexts.
 */

import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { userStatusEnum } from './_enums.ts'

export const users = pgTable('users', {
  // -------------------------------------------------------------------------
  // Identity (immutable after creation)
  // -------------------------------------------------------------------------

  /** Opaque UUID primary key. Stable across email changes. */
  id: uuid('id').primaryKey().defaultRandom(),

  // -------------------------------------------------------------------------
  // Authentication identity
  // -------------------------------------------------------------------------

  /**
   * Email address — primary login credential and communication channel.
   * Unique across the platform (not org-scoped — one account per email).
   * Sensitive: LGPD PII. Access logged when exported.
   * Mutable: users may change email via verified flow; each change is audited.
   */
  email: text('email').notNull().unique(),

  /**
   * Human-readable display name. Used in UI attribution and audit records.
   * Does not need to be the legal name — just the working identity.
   */
  displayName: text('display_name').notNull(),

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Account status.
   * Transitions: invited → active → suspended | deactivated.
   * Deactivated users cannot approve pieces, dismiss critical deadlines,
   * or confirm snapshots (enforced at service layer).
   * Architecture ref: data-model-v1.md §2.1 lifecycle.
   */
  status: userStatusEnum('status').notNull().default('invited'),

  // -------------------------------------------------------------------------
  // Professional identity (optional)
  // -------------------------------------------------------------------------

  /**
   * Brazilian OAB registration number (Ordem dos Advogados do Brasil).
   * Required for users with lawyer role to be eligible to approve pieces and
   * confirm legal conclusions. Validation at service layer, not DB constraint
   * (assistants legitimately have no bar number).
   * Sensitive: professional identifier.
   */
  barNumber: text('bar_number'),

  // -------------------------------------------------------------------------
  // Contact (optional, sensitive)
  // -------------------------------------------------------------------------

  /**
   * Phone number for push notifications and 2FA (future).
   * Sensitive: LGPD PII.
   */
  phone: text('phone'),

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  /**
   * URL of the user's avatar image stored in R2.
   * Signed URL generation happens at query time — this field stores the object key,
   * not the signed URL. Architecture ref: technical-stack-decision.md §6.1.
   */
  avatarUrl: text('avatar_url'),

  // -------------------------------------------------------------------------
  // Session tracking
  // -------------------------------------------------------------------------

  /**
   * Timestamp of the user's most recent authenticated session.
   * Used for: stale-account detection, security monitoring.
   * Not used for business logic. Updated by auth middleware on login.
   */
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

  // -------------------------------------------------------------------------
  // Timestamps
  // -------------------------------------------------------------------------

  /** When the user account was created. Immutable. */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  /** Last time any mutable field on this record was updated. */
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  /**
   * When the user account was deactivated, if ever.
   * Null for active users. Set when status → deactivated.
   * Deactivated users' attribution records remain fully intact.
   */
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
