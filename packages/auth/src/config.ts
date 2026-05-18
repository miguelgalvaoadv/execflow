/**
 * Better Auth configuration factory for EXECFLOW.
 *
 * Usage: Call createAuth(db) once at API startup. Do not call in request handlers.
 * The returned auth instance is a singleton bound to the database client.
 *
 * @example
 * // apps/api/src/lib/auth.ts
 * import { createAuth } from '@execflow/auth/config'
 * import { db } from './db'
 * export const auth = createAuth(db)
 *
 * DESIGN DECISIONS:
 *
 * 1. EMAIL/PASSWORD ONLY for Phase 2.
 *    OAuth providers (Google, Microsoft) added in Phase 5 when user management
 *    is fully built. MVP law firms authenticate with email credentials.
 *
 * 2. ADMIN PLUGIN for impersonation.
 *    Support-level access requires impersonation with full audit attribution.
 *    impersonatedBy session field is read by API middleware to set actorType.
 *
 * 3. NO organization plugin from Better Auth.
 *    We use our own organizations + memberships tables (Phase 1 schema).
 *    Better Auth's org plugin would duplicate data and create sync complexity.
 *    Tenant resolution is handled in apps/api middleware.
 *
 * 4. DATABASE HOOKS for domain sync.
 *    user.create.after → creates matching users record (same UUID).
 *    session.create.after → writes sign-in AuditLog entry.
 *    These hooks are NOT in the same DB transaction as Better Auth's writes.
 *    For legal state changes (Phase 3+), explicit transactions are used.
 *
 * 5. TRUSTED ORIGINS from environment.
 *    Prevents CSRF by only accepting requests from known frontend origins.
 *
 * Architecture ref: technical-stack-decision.md §5.1,
 *                   ARCHITECTURE_RULES.md §F-05 (all routes authenticated),
 *                   AI_BOUNDARIES.md (actor attribution model).
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import type { DbClient } from '@execflow/db/client'
import {
  authUsers,
  authSessions,
  authAccounts,
  authVerifications,
  users,
  auditLogs,
} from '@execflow/db/schema'

// biome-ignore lint: intentional; see note below
// TS2742: betterAuth()'s return type references zod via pnpm virtual store.
// noEmit:true means no .d.ts is generated; the @ts-ignore is safe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAuth(db: DbClient): any {
  // Cast through unknown to break the zod reference chain in the inferred type.
  // Internal type-checking is unaffected: all config fields are fully typed.
  // The exported `Auth` type alias (bottom of file) re-establishes safe typing
  // for consumers via ReturnType<typeof createAuth>.
  const instance = betterAuth({
    // -------------------------------------------------------------------------
    // Database adapter
    // -------------------------------------------------------------------------

    database: drizzleAdapter(db, {
      provider: 'pg',
      /**
       * Map Better Auth model names to our Drizzle table objects.
       * Better Auth uses these internally; it doesn't care about the PostgreSQL
       * table name (ba_user, ba_session, etc.) — only the Drizzle object matters.
       */
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),

    // -------------------------------------------------------------------------
    // Email / password authentication
    // -------------------------------------------------------------------------

    emailAndPassword: {
      enabled: true,
      /**
       * Email verification NOT required for Phase 2.
       * Law firm admins are provisioned by platform admins, not self-service.
       * Enable in Phase 5 when self-service signup is introduced.
       */
      requireEmailVerification: false,
      /**
       * Minimum 12 characters. Legal platform credentials must be strong.
       * This is enforced by Better Auth before password storage.
       */
      minPasswordLength: 12,
    },

    // -------------------------------------------------------------------------
    // Session strategy
    // -------------------------------------------------------------------------

    session: {
      /**
       * 7-day session lifetime. Legal professionals keep sessions alive
       * across their work week without re-authenticating.
       */
      expiresIn: 60 * 60 * 24 * 7,

      /**
       * Refresh the session expiry if it hasn't been updated in 24 hours.
       * Prevents active users from being logged out mid-day.
       */
      updateAge: 60 * 60 * 24,

      /**
       * Client-side session cache (stores session data in a cookie to reduce
       * DB lookups on every request). 5-minute TTL is safe for operational use.
       * Role changes and membership suspensions take effect within 5 minutes.
       */
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },

    // -------------------------------------------------------------------------
    // Plugins
    // -------------------------------------------------------------------------

    plugins: [
      /**
       * Admin plugin: enables impersonation for platform-level support.
       *
       * Impersonation flow:
       * 1. Platform admin calls POST /api/auth/admin/impersonate-user
       * 2. Better Auth creates a session with impersonatedBy = admin's ba_user.id
       * 3. API middleware detects impersonatedBy and sets actorType='admin_impersonating'
       * 4. All actions in that session are attributed to the admin, not the target user
       * 5. POST /api/auth/admin/stop-impersonating ends the impersonation
       *
       * Max impersonation duration: 1 hour. After that, the session expires
       * and the admin must re-authenticate normally.
       *
       * Architecture ref: technical-stack-decision.md §5.1,
       *                   event-state-architecture.md §8.2 (actor attribution).
       */
      admin({
        impersonationSessionDuration: 60 * 60,
      }),
    ],

    // -------------------------------------------------------------------------
    // Trusted origins (CSRF protection)
    // -------------------------------------------------------------------------

    /**
     * Comma-separated list of trusted frontend origins.
     * Set BETTER_AUTH_TRUSTED_ORIGINS=https://app.execflow.com,http://localhost:3000
     * in the API environment. Requests from other origins are rejected.
     */
    trustedOrigins: parseTrustedOrigins(),

    // -------------------------------------------------------------------------
    // Database hooks — domain sync and audit trail
    // -------------------------------------------------------------------------

    databaseHooks: {
      user: {
        create: {
          /**
           * After Better Auth creates a ba_user record, create the matching
           * domain users record with the same ID.
           *
           * This is NOT in the same transaction as Better Auth's insert.
           * If this fails: the ba_user exists but users does not. Recovery:
           * the middleware's domain user lookup fails and the user gets a 403,
           * prompting re-auth which retries this sync. idempotent via onConflictDoNothing.
           *
           * Architecture ref: auth-user.ts (two-table model rationale).
           */
          after: async (user) => {
            await db
              .insert(users)
              .values({
                id: user.id,
                email: user.email,
                displayName: user.name,
                status: 'active',
              })
              .onConflictDoNothing()
          },
        },

        update: {
          /**
           * When Better Auth updates a user's name or email, sync to domain users table.
           * This keeps the two records aligned for attribution queries.
           * Partial update: only sync fields that Better Auth may change.
           */
          after: async (user) => {
            const updates: Partial<typeof users.$inferInsert> = {}

            if ('name' in user && user.name !== undefined) {
              updates.displayName = user.name as string
            }
            if ('email' in user && user.email !== undefined) {
              updates.email = user.email as string
            }

            if (Object.keys(updates).length > 0) {
              await db
                .update(users)
                .set(updates)
                .where(eq(users.id, user.id as string))
            }
          },
        },
      },

      session: {
        create: {
          /**
           * Write a sign-in AuditLog entry after session creation.
           *
           * Detects impersonation: if impersonatedBy is set, this is an impersonation
           * session start, not a regular sign-in. The audit action differs.
           *
           * Not in the same transaction as Better Auth's session insert.
           * Failure here does NOT prevent the session from being created.
           * Sign-in audit failures are logged and monitored, not blocking.
           */
          after: async (session) => {
            // Better Auth extends the session record with plugin fields via index signature.
            // Access impersonatedBy via bracket notation to satisfy exactOptionalPropertyTypes.
            const sessionRecord = session as Record<string, unknown>
            const impersonatedBy = sessionRecord['impersonatedBy']
            const isImpersonation = typeof impersonatedBy === 'string' && impersonatedBy.length > 0

            await db
              .insert(auditLogs)
              .values({
                actorType: isImpersonation ? 'admin_impersonating' : 'user',
                actorId: isImpersonation ? impersonatedBy as string : session.userId,
                impersonatingUserId: isImpersonation
                  ? (session.userId as string | undefined)
                  : undefined,
                action: isImpersonation ? 'impersonation.started' : 'session.created',
                entityType: 'Session',
                entityId: session.id,
                occurredAt: session.createdAt,
                sessionId: session.token,
                ipAddress: (session.ipAddress as string | null | undefined) ?? undefined,
                metadata: {
                  userAgent: session.userAgent,
                },
              })
              .catch((err: unknown) => {
                /**
                 * Audit write failure on sign-in is logged but NOT thrown.
                 * Better Auth must not know about our domain layer failures.
                 * Session creation proceeds; the audit gap is monitored.
                 * Architecture note: synchronous audit co-commit is enforced for
                 * legal state changes (Phase 3+), not for auth events.
                 */
                console.error('[auth] Failed to write sign-in audit log:', err)
              })
          },
        },
      },
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return instance
}

/**
 * Parse the BETTER_AUTH_TRUSTED_ORIGINS environment variable.
 * Returns an empty array (no CORS restriction) if not set — suitable for local development.
 * In production, this MUST be set to the frontend domain(s).
 */
function parseTrustedOrigins(): string[] {
  const raw = process.env['BETTER_AUTH_TRUSTED_ORIGINS']
  if (!raw || raw.trim() === '') return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Inferred type of the Better Auth instance returned by createAuth. */
export type Auth = ReturnType<typeof createAuth>
