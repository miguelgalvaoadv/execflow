/**
 * Zod validation helpers for route handlers.
 *
 * All route handlers validate request bodies with Zod before passing to services.
 * This file provides shared utilities to keep route handlers thin and consistent.
 *
 * Architecture ref: ENGINEERING_PRINCIPLES.md §8 (typed boundaries everywhere).
 */

import { z } from 'zod'

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; message: string; issues: z.ZodIssue[] }

/**
 * Parse and validate an arbitrary value against a Zod schema.
 * Returns a typed result — never throws.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): ParseResult<T> {
  const result = schema.safeParse(body)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const firstIssue = result.error.issues[0]
  const message = firstIssue
    ? `${firstIssue.path.join('.') || 'body'}: ${firstIssue.message}`
    : 'Request body validation failed.'
  return { success: false, message, issues: result.error.issues }
}
