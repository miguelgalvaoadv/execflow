/**
 * ServiceResult — the canonical result type for all domain service functions.
 *
 * Services never throw. They return a typed result that maps cleanly to
 * HTTP status codes in route handlers. This pattern ensures every failure
 * mode is handled explicitly at the call site.
 *
 * Route handlers pattern-match on error.code to select the HTTP status:
 *   VALIDATION   → 422 Unprocessable
 *   CONFLICT     → 409 Conflict
 *   NOT_FOUND    → 404 Not Found
 *   FORBIDDEN    → 403 Forbidden
 *   INTERNAL     → 500 Internal Server Error
 */

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: ServiceError }

export type ServiceError = {
  /**
   * Error category.
   * VALIDATION: input fails domain rules (missing field, invalid CPF, etc.)
   * CONFLICT:   unique constraint violation (duplicate process number, CPF)
   * NOT_FOUND:  entity not found or not visible in this org
   * FORBIDDEN:  actor does not have permission for this operation
   * INTERNAL:   unexpected failure (DB error, invariant violation)
   */
  code: 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL'
  message: string
  /** Field name for field-level validation errors. */
  field?: string | undefined
  /** The underlying cause for debugging (not exposed to API clients). */
  cause?: unknown
}

/** Construct a success result. */
export function ok<T>(data: T): ServiceResult<T> {
  return { success: true, data }
}

/** Construct a validation error. */
export function validationError(message: string, field?: string | undefined): ServiceResult<never> {
  const error: ServiceError = { code: 'VALIDATION', message }
  if (field !== undefined) error.field = field
  return { success: false, error }
}

/** Construct a conflict error. */
export function conflictError(message: string): ServiceResult<never> {
  return { success: false, error: { code: 'CONFLICT', message } }
}

/** Construct a not-found error. */
export function notFoundError(message: string): ServiceResult<never> {
  return { success: false, error: { code: 'NOT_FOUND', message } }
}

/** Construct a forbidden error. */
export function forbiddenError(message: string): ServiceResult<never> {
  return { success: false, error: { code: 'FORBIDDEN', message } }
}

/** Construct an internal error. */
export function internalServiceError(message: string, cause?: unknown): ServiceResult<never> {
  return { success: false, error: { code: 'INTERNAL', message, cause } }
}

/**
 * Map a RepositoryError code to a ServiceError code.
 * Repositories report lower-level errors; services translate to domain terms.
 */
export function fromRepositoryError(
  repoCode: string,
  message: string,
  cause?: unknown
): ServiceResult<never> {
  const code =
    repoCode === 'NOT_FOUND'   ? 'NOT_FOUND' as const :
    repoCode === 'CONFLICT'    ? 'CONFLICT' as const :
    repoCode === 'FORBIDDEN'   ? 'FORBIDDEN' as const :
    'INTERNAL' as const

  return { success: false, error: { code, message, cause } }
}
