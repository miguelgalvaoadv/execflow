/**
 * Better Auth account table — OAuth provider connections and credential storage.
 *
 * Each row represents one authentication method for a user:
 * - Email/password: providerId='credential', password stores the hashed password.
 * - Google OAuth: providerId='google', accountId is the Google user ID.
 * - Future: Microsoft, GitHub, etc.
 *
 * A user may have multiple accounts (e.g., email/password AND Google OAuth
 * linking to the same email). Better Auth manages the account linking flow.
 *
 * LGPD sensitivity:
 * - passwords are bcrypt-hashed by Better Auth before storage. Never raw.
 * - OAuth tokens (accessToken, refreshToken) are stored for providers that
 *   require re-auth. These are sensitive credentials — access is restricted
 *   to the auth layer and never exposed via the API.
 *
 * Architecture ref: technical-stack-decision.md §5.1 (Better Auth security model).
 */

import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'
import { authUsers } from './auth-user.ts'

export const authAccounts = pgTable(
  'ba_account',
  {
    /** Better Auth account ID. */
    id: text('id').primaryKey(),

    /**
     * Provider-specific user identifier.
     * For credential (email/password): same as ba_user.id.
     * For OAuth: the provider's user ID (e.g., Google user ID).
     */
    accountId: text('account_id').notNull(),

    /**
     * Authentication provider identifier.
     * Values: 'credential' | 'google' | 'microsoft' | etc.
     * Determines which fields are populated and how auth flow proceeds.
     */
    providerId: text('provider_id').notNull(),

    /** The user this account belongs to. CASCADE DELETE on user removal. */
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),

    /** OAuth access token. Sensitive — never exposed via API. */
    accessToken: text('access_token'),

    /** OAuth refresh token. Sensitive — used for token refresh flows. */
    refreshToken: text('refresh_token'),

    /** OAuth ID token (OpenID Connect). */
    idToken: text('id_token'),

    /** When the access token expires. */
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),

    /** When the refresh token expires. */
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),

    /** OAuth scopes granted to this account. */
    scope: text('scope'),

    /**
     * Hashed password for credential accounts.
     * Better Auth uses bcrypt. Never stored raw. Never exposed in any API response.
     * LGPD: password hash is personal data — access restricted to auth layer.
     */
    password: text('password'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    /** Fast lookup: "all auth methods for user X." */
    index('ba_account_user_idx').on(table.userId),

    /** Fast lookup: "does account X from provider Y exist?" */
    index('ba_account_provider_idx').on(table.providerId, table.accountId),
  ]
)

export type AuthAccount = typeof authAccounts.$inferSelect
export type NewAuthAccount = typeof authAccounts.$inferInsert
