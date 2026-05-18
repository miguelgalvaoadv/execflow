/**
 * Better Auth session table.
 *
 * Sessions are the auth layer's primary trust mechanism. Every authenticated
 * API request arrives with a session token that Better Auth validates against
 * this table. The resolved session provides the user identity for all
 * subsequent middleware (org resolution, RBAC, audit attribution).
 *
 * CUSTOM FIELDS (beyond Better Auth defaults):
 *
 * - activeOrganizationId: Which org is currently active for this session.
 *   Set via `PUT /api/v1/me/session/active-organization`. Used by the frontend
 *   to restore org context after page refresh. The API middleware primarily
 *   reads the `X-Organization-Id` request header; this field is secondary.
 *
 * - impersonatedBy: Admin user ID that initiated this impersonation session.
 *   Set by Better Auth's admin plugin when `POST /api/auth/admin/impersonate-user`.
 *   When present, the API middleware sets actorType='admin_impersonating'.
 *   Actions taken during impersonation are NEVER attributed to the session user.
 *   Architecture ref: ARCHITECTURE_RULES.md §F-05, technical-stack-decision.md §5.1.
 *
 * SECURITY:
 * - Tokens are stored hashed in Better Auth (raw token sent in cookie, hash stored here).
 * - Sessions expire after 7 days (configurable in packages/auth/src/config.ts).
 * - Session deletion (sign-out) writes an AuditLog entry (auth-audit plugin).
 * - Multiple simultaneous sessions per user are supported (multi-device).
 *
 * Architecture ref: event-state-architecture.md §8.3 (session attribution).
 */

import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'
import { authUsers } from './auth-user.ts'

export const authSessions = pgTable(
  'ba_session',
  {
    /** Better Auth session ID. */
    id: text('id').primaryKey(),

    /** When this session expires. Sessions past this date are rejected. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /**
     * Session token. Sent as a cookie to the client.
     * Better Auth validates the cookie value against this stored token.
     * Unique across all sessions (not just per-user).
     */
    token: text('token').notNull().unique(),

    /** When this session was created. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),

    /** When this session was last refreshed. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),

    /** IP address of the client at session creation. Nullable (proxied requests may not have it). */
    ipAddress: text('ip_address'),

    /** User-Agent header from the browser/client at session creation. */
    userAgent: text('user_agent'),

    /**
     * The authenticated user. References ba_user (auth layer, not domain users table).
     * CASCADE DELETE: sessions are invalidated when the auth user is deleted.
     */
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),

    // -------------------------------------------------------------------------
    // Custom fields
    // -------------------------------------------------------------------------

    /**
     * The organization ID that is currently active for this session.
     * Stored as a UUID string (not typed uuid for FK reasons - the organizations
     * table has uuid PK, this is a denormalized reference).
     * Null until the user explicitly activates an organization.
     * The API middleware validates this value against the memberships table on each request.
     */
    activeOrganizationId: text('active_organization_id'),

    /**
     * Admin impersonation field. Set by Better Auth admin plugin only.
     * Contains the ba_user.id of the admin who initiated the impersonation.
     * When non-null: actorType must be 'admin_impersonating' for all audit entries.
     * NEVER attribute impersonated actions to the session's userId.
     * Architecture ref: technical-stack-decision.md §5.1 (impersonation safety).
     */
    impersonatedBy: text('impersonated_by'),
  },
  (table) => [
    /** Fast session lookup by user (for listing active sessions, revoking all). */
    index('ba_session_user_idx').on(table.userId),

    /** Fast expiry cleanup query. */
    index('ba_session_expires_idx').on(table.expiresAt),
  ]
)

export type AuthSession = typeof authSessions.$inferSelect
export type NewAuthSession = typeof authSessions.$inferInsert
