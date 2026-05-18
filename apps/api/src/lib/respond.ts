/**
 * Standard API error responses.
 *
 * All API errors follow a consistent JSON shape:
 *   { error: { code: string, message: string, requestId?: string } }
 *
 * This makes error handling predictable for the frontend and automatable
 * in tests. Error codes are stable constants; messages may evolve.
 *
 * Design: Production environments return minimal detail in messages.
 * Debug information goes to structured logs (Pino), not HTTP responses.
 * Architecture ref: ENGINEERING_PRINCIPLES.md §7 (operational calm).
 */

import type { Context } from 'hono'

export type ApiError = {
  code: string
  message: string
  requestId?: string
}

export type ApiErrorResponse = { error: ApiError }

/**
 * 401 Unauthorized — no valid session found.
 * Returned when the session cookie is missing, expired, or invalid.
 */
export function unauthorized(c: Context, message = 'Authentication required.'): Response {
  return c.json<ApiErrorResponse>(
    { error: { code: 'UNAUTHORIZED', message } },
    401
  )
}

/**
 * 403 Forbidden — session is valid but the actor lacks the required permission.
 * Returned when:
 * - User is not a member of the requested organization
 * - Membership is suspended
 * - Role is insufficient for the operation
 * - Account is banned
 */
export function forbidden(c: Context, message = 'Access denied.'): Response {
  return c.json<ApiErrorResponse>(
    { error: { code: 'FORBIDDEN', message } },
    403
  )
}

/**
 * 404 Not Found — entity does not exist or is not visible to the requesting org.
 * Never reveal whether an entity exists in another org — always return 404.
 * Architecture ref: ARCHITECTURE_RULES.md §M-01 (org-scoped queries).
 */
export function notFound(c: Context, message = 'Not found.'): Response {
  return c.json<ApiErrorResponse>(
    { error: { code: 'NOT_FOUND', message } },
    404
  )
}

/**
 * 409 Conflict — the request conflicts with current state.
 * Returned for: duplicate process numbers, unique constraint violations,
 * invalid state machine transitions.
 */
export function conflict(c: Context, message: string): Response {
  return c.json<ApiErrorResponse>(
    { error: { code: 'CONFLICT', message } },
    409
  )
}

/**
 * 422 Unprocessable — validation failed or business rule rejected the input.
 * Returned for: missing required fields, invalid enum values, invalid transitions.
 */
export function unprocessable(c: Context, message: string, detail?: unknown): Response {
  return c.json<ApiErrorResponse & { detail?: unknown }>(
    { error: { code: 'UNPROCESSABLE', message }, ...(detail ? { detail } : {}) },
    422
  )
}

/**
 * 500 Internal Server Error — unexpected error in the service layer.
 * In production: generic message only. In development: includes error.
 * Never return stack traces in production.
 */
export function internalError(c: Context, err?: unknown): Response {
  const isDev = process.env['NODE_ENV'] === 'development'

  return c.json<ApiErrorResponse>(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: isDev && err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.',
      },
    },
    500
  )
}
