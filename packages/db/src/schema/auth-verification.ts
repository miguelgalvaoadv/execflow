/**
 * Better Auth verification table — short-lived tokens for email flows.
 *
 * Used for:
 * - Email verification on sign-up (identifier = email, value = verification token)
 * - Password reset links (identifier = email, value = reset token)
 * - Magic link sign-in (future, identifier = email, value = magic token)
 * - 2FA challenges (future)
 *
 * Tokens expire via `expiresAt`. Better Auth cleans up expired tokens periodically.
 * Records are deleted after successful verification — they are NOT append-only.
 * This table does not require an AuditLog entry per verification; the resulting
 * action (email verified, password changed) produces the audit entry.
 *
 * SECURITY: Token values should be treated as short-lived secrets.
 * They are never exposed in API responses or logs.
 */

import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'

export const authVerifications = pgTable(
  'ba_verification',
  {
    /** Better Auth verification record ID. */
    id: text('id').primaryKey(),

    /**
     * The subject being verified. Typically an email address.
     * Used to look up pending verifications for a given identifier.
     */
    identifier: text('identifier').notNull(),

    /**
     * The verification token value.
     * Sent to the user out-of-band (email link).
     * Better Auth hashes before storage in some configurations.
     */
    value: text('value').notNull(),

    /** When this token becomes invalid. Better Auth rejects expired tokens. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    /** Fast lookup: "is there a pending verification for identifier X?" */
    index('ba_verification_identifier_idx').on(table.identifier),

    /** Cleanup query: expired verifications. */
    index('ba_verification_expires_idx').on(table.expiresAt),
  ]
)

export type AuthVerification = typeof authVerifications.$inferSelect
export type NewAuthVerification = typeof authVerifications.$inferInsert
