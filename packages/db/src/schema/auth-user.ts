/**
 * Better Auth user table — auth-layer identity, separate from the domain `users` table.
 *
 * ARCHITECTURE: Two-table user model.
 *
 *   ba_user  (this file)  ← Better Auth owns: sessions, passwords, OAuth, impersonation
 *   users    (user.ts)    ← EXECFLOW owns: legal attribution, bar number, status, roles
 *
 * The two records share the same UUID value as their IDs.
 * ba_user.id is `text` (Better Auth standard) storing a valid UUID string.
 * users.id   is `uuid` (PostgreSQL native UUID).
 * PostgreSQL handles the implicit cast in join conditions.
 *
 * SYNC: When Better Auth creates a ba_user record, a databaseHook in packages/auth
 * creates the matching `users` record. The two are always in 1:1 correspondence.
 *
 * WHY SEPARATE:
 * - Better Auth's schema requirements (field names, types) differ from our domain schema.
 * - The `users` table is referenced by AuditLog, FilingApproval, SentenceSnapshot, etc.
 *   with PostgreSQL UUID FK constraints. Those can't reference a text column.
 * - Clean separation allows Better Auth to be upgraded/replaced without touching
 *   the domain attribution schema.
 *
 * Architecture ref: technical-stack-decision.md §5.1 (Better Auth rationale),
 *                   ARCHITECTURE_RULES.md §F-05 (all routes authenticated).
 */

import { pgTable, text, timestamp, boolean, index } from 'drizzle-orm/pg-core'

export const authUsers = pgTable(
  'ba_user',
  {
    // -------------------------------------------------------------------------
    // Identity — Better Auth standard fields
    // -------------------------------------------------------------------------

    /**
     * Better Auth user ID. Text-stored UUID.
     * Must match the corresponding users.id value (same UUID, different type).
     */
    id: text('id').primaryKey(),

    /** User's display name. Synced to users.display_name on write. */
    name: text('name').notNull(),

    /** Primary login credential. Unique across the platform. LGPD: PII. */
    email: text('email').notNull().unique(),

    /**
     * Whether the user has verified their email address.
     * Better Auth manages verification token flow; this is the outcome flag.
     */
    emailVerified: boolean('email_verified').notNull().default(false),

    /**
     * Profile image URL. Better Auth standard field for OAuth profile images.
     * For EXECFLOW users: stores the R2-signed URL path (same as users.avatar_url).
     */
    image: text('image'),

    /** When this auth record was created. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),

    /** Last time this record was updated by Better Auth. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),

    // -------------------------------------------------------------------------
    // Better Auth admin plugin fields
    // -------------------------------------------------------------------------

    /**
     * Platform-level role. NOT the same as org membership role.
     * Values: 'user' (default) | 'admin' (platform admin with impersonation rights).
     * Org-level roles (admin, lawyer, assistant) live in the memberships table.
     * Architecture ref: technical-stack-decision.md §5.1 (RBAC model).
     */
    role: text('role'),

    /**
     * Whether this account has been banned from the platform.
     * Banned users cannot create sessions. Enforcement in Better Auth middleware.
     */
    banned: boolean('banned'),

    /** Human-readable reason for the ban. Required when banned=true. */
    banReason: text('ban_reason'),

    /**
     * When the ban expires. Null = permanent ban.
     * Better Auth checks this on session creation; expired bans auto-lift.
     */
    banExpires: timestamp('ban_expires', { withTimezone: true }),
  },
  (table) => [
    index('ba_user_email_idx').on(table.email),
  ]
)

export type AuthUser = typeof authUsers.$inferSelect
export type NewAuthUser = typeof authUsers.$inferInsert
