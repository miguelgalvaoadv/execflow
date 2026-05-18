/**
 * Better Auth instance for apps/api.
 *
 * This is the singleton auth object used across all middleware and route handlers.
 * Created once at startup from the db client and environment configuration.
 *
 * Exports:
 * - auth: the Better Auth instance
 * - authHandler: the Hono-compatible request handler for /api/auth/** routes
 */

import { createAuth } from '@execflow/auth/config'
import { db } from './db.ts'

const secret = process.env['BETTER_AUTH_SECRET']

if (!secret || secret.length < 32) {
  throw new Error(
    '[apps/api] BETTER_AUTH_SECRET is required and must be at least 32 characters. ' +
    'Generate with: openssl rand -base64 32'
  )
}

export const auth = createAuth(db)

/**
 * Hono-compatible handler that delegates all /api/auth/** requests to Better Auth.
 * Mount with: app.on(['GET', 'POST'], '/api/auth/**', authHandler)
 *
 * Better Auth handles:
 *   POST /api/auth/sign-in/email         → email/password sign-in
 *   POST /api/auth/sign-up/email         → new account registration
 *   POST /api/auth/sign-out              → session invalidation
 *   GET  /api/auth/session               → get current session
 *   POST /api/auth/forget-password       → password reset initiation
 *   POST /api/auth/reset-password        → password reset completion
 *   GET  /api/auth/verify-email          → email verification (link click)
 *   POST /api/auth/admin/impersonate-user → start impersonation (admin only)
 *   POST /api/auth/admin/stop-impersonating → end impersonation
 */
export function authHandler(c: { req: { raw: Request } }): Promise<Response> {
  return auth.handler(c.req.raw)
}
