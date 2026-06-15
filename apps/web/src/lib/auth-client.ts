/**
 * Better Auth browser client for EXECFLOW frontend.
 *
 * This is the ONLY place the frontend interacts with the auth system.
 * All auth calls go through this client — never call /api/auth/** directly.
 *
 * The client communicates with apps/api (Better Auth server).
 * Session cookies are HttpOnly and managed by the browser — not accessible to JS.
 *
 * USAGE RULES:
 * - Import { authClient } for all auth operations in frontend components.
 * - NEVER store session tokens in localStorage or non-HttpOnly cookies.
 * - NEVER use this client for permission enforcement — use server-side checks.
 * - Role/permission data from the session is for UX rendering ONLY.
 *   Architecture ref: ARCHITECTURE_RULES.md §F-01 (no business logic in frontend).
 *
 * Phase 2: Email/password only. OAuth providers added in Phase 5.
 * Phase 2: Admin plugin client (for impersonation) — admin UI in Phase 6.
 */

import { createAuthClient } from 'better-auth/client'
import { adminClient } from 'better-auth/client/plugins'

// Browser: URL relativa → proxy Next.js → cookie same-origin
// SSR: URL absoluta da API
const apiUrl =
  typeof window !== 'undefined'
    ? '' // relativa: passa pelo proxy em localhost:3000
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001')

/**
 * Better Auth browser client.
 *
 * Available methods:
 *   authClient.signIn.email({ email, password })       → sign in
 *   authClient.signUp.email({ email, password, name }) → register
 *   authClient.signOut()                               → sign out
 *   authClient.getSession()                            → get current session
 *   authClient.useSession()                            → React hook for session
 *   authClient.admin.impersonateUser({ userId })       → start impersonation
 *   authClient.admin.stopImpersonating()               → end impersonation
 */
export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [
    adminClient(),
  ],
})

export type { Session } from 'better-auth/types'
