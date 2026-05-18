/**
 * Route handler utilities — shared helpers for all API route files.
 *
 * Provides:
 * - serviceErrorToResponse(): maps ServiceError codes to HTTP responses
 * - safeJsonBody(): safely parse request body without throwing
 *
 * These keep route handlers thin: parse body → call service → map result.
 */

import type { Context } from 'hono'
import { conflict, notFound, forbidden, unprocessable, internalError } from './respond.ts'
import type { ServiceError } from '../services/result.ts'

/**
 * Map a ServiceError to the appropriate HTTP error response.
 * Use at the end of route handlers when service returns success=false.
 *
 * @example
 * if (!result.success) return serviceErrorToResponse(c, result.error)
 * return c.json(result.data, 201)
 */
export function serviceErrorToResponse(c: Context, error: ServiceError): Response {
  switch (error.code) {
    case 'CONFLICT':
      return conflict(c, error.message)
    case 'NOT_FOUND':
      return notFound(c, error.message)
    case 'FORBIDDEN':
      return forbidden(c, error.message)
    case 'VALIDATION':
      return unprocessable(c, error.message, error.field ? { field: error.field } : undefined)
    case 'INTERNAL':
    default:
      return internalError(c)
  }
}

/**
 * Safely parse request body as JSON.
 * Returns null on parse failure instead of throwing.
 * Route handlers should return 422 when body is null.
 */
export async function safeJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}
