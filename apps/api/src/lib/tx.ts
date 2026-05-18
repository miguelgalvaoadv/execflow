/**
 * Transaction helpers for EXECFLOW service layer.
 *
 * All domain writes (state change + AuditLog + DomainEvent) must be co-committed
 * in a single transaction. This module provides the typed helpers for that pattern.
 *
 * RULE: No domain service writes outside a transaction.
 * This is enforced structurally: service functions receive `ctx.db` (DbClient)
 * and open their own transaction. Repository write functions accept `DbTransaction`
 * (not `DbClient`) — this forces callers to be inside a transaction.
 *
 * Architecture ref: packages/db/src/client/index.ts (transaction pattern),
 *                   ENGINEERING_PRINCIPLES.md §4 (no silent mutations).
 */

import type { DbClient, DbTransaction } from './db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

/**
 * Execute a function inside a database transaction.
 * If the function throws or returns a RepositoryResult with success=false,
 * the transaction is automatically rolled back.
 *
 * Usage:
 *   const result = await withTx(db, async (tx) => {
 *     const client = await insertClient(tx, data)
 *     await insertAuditLog(tx, auditEntry)
 *     await insertDomainEvent(tx, domainEvent)
 *     return client
 *   })
 */
export async function withTx<T>(
  db: DbClient,
  fn: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(fn)
}

/**
 * Unwrap a RepositoryResult inside a transaction callback.
 * If the result is an error, throw it so the transaction is rolled back.
 *
 * Usage:
 *   const client = unwrapOrThrow(await insertClient(tx, data))
 *   // continues only if insert succeeded
 */
export function unwrapOrThrow<T>(result: RepositoryResult<T>): T {
  if (!result.success) {
    throw new TxRepositoryError(result.error.code, result.error.message, result.error.cause ?? undefined)
  }
  return result.data
}

/**
 * Typed error thrown when unwrapOrThrow encounters a repository failure.
 * Caught by withTx to trigger rollback.
 *
 * Note: named `rootCause` to avoid shadowing the ES2022 Error.cause property.
 */
export class TxRepositoryError extends Error {
  readonly code: string
  readonly rootCause: unknown

  constructor(code: string, message: string, rootCause?: unknown) {
    super(message)
    this.name = 'TxRepositoryError'
    this.code = code
    this.rootCause = rootCause
  }
}
