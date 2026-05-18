/**
 * Database client factories for EXECFLOW.
 *
 * Two factories:
 * - createDbClient:     Neon HTTP driver — for serverless/Edge API routes
 * - createPoolDbClient: Neon WebSocket Pool driver — for long-running workers
 *
 * Both use the same drizzle-orm instance from this package, which is critical
 * for TypeScript type compatibility: workers must use these factories (not
 * install their own drizzle-orm) so schema types remain compatible.
 *
 * Architecture ref: technical-stack-decision.md §3.1 (PostgreSQL + Neon),
 *                   technical-stack-decision.md §2.3 (worker architecture).
 *
 * TRANSACTION PATTERN:
 * All writes that must be co-committed (state change + AuditLog + DomainEvent)
 * must use the transaction helper:
 *
 *   await db.transaction(async (tx) => {
 *     await tx.insert(someTable).values(...)
 *     await tx.insert(auditLogs).values(auditEntry)
 *     await tx.insert(domainEvents).values(outboxEvent)
 *   })
 *
 * Architecture ref: ENGINEERING_PRINCIPLES.md §4 (no silent mutations),
 *                   event-state-architecture.md §1.3 (immutable audit trails).
 */

import { drizzle } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePool } from 'drizzle-orm/neon-serverless'
import { neon, Pool } from '@neondatabase/serverless'
import * as schema from '../schema/index.ts'

// ---------------------------------------------------------------------------
// HTTP client (serverless / Edge functions)
// ---------------------------------------------------------------------------

/**
 * Creates a Drizzle client using the Neon HTTP transport.
 * Suitable for serverless / Edge functions (apps/api, apps/web).
 * Does NOT support long-running connections or full transaction isolation.
 */
export function createDbClient(connectionString: string) {
  const sql = neon(connectionString)
  return drizzle(sql, { schema })
}

export type DbClient = ReturnType<typeof createDbClient>

export type DbTransaction = Parameters<
  Parameters<DbClient['transaction']>[0]
>[0]

// ---------------------------------------------------------------------------
// Pool client (long-running worker processes)
// ---------------------------------------------------------------------------

/**
 * Creates a Drizzle client using the Neon WebSocket Pool transport.
 * Suitable for long-running Node.js processes (packages/workers).
 * Supports real transactions with SERIALIZABLE isolation and FOR UPDATE locks.
 *
 * The caller must configure the WebSocket constructor for Node.js BEFORE
 * calling this function:
 *
 *   import ws from 'ws'
 *   import { neonConfig } from '@neondatabase/serverless'
 *   neonConfig.webSocketConstructor = ws
 *   const db = createPoolDbClient(process.env.DATABASE_URL)
 */
export function createPoolDbClient(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5 })
  return drizzlePool(pool, { schema })
}

export type PoolDbClient = ReturnType<typeof createPoolDbClient>

export type PoolDbTransaction = Parameters<
  Parameters<PoolDbClient['transaction']>[0]
>[0]

/**
 * Union of both DB client types.
 * Use this in packages (like @execflow/engine) that may be called from
 * both the HTTP API (DbClient) and the pool-based workers (PoolDbClient).
 */
export type AnyDbClient = DbClient | PoolDbClient

export type AnyDbTransaction = DbTransaction | PoolDbTransaction

/**
 * Drizzle overload resolution breaks on `DbClient | PoolDbClient` (and the
 * equivalent transaction union): `insert().returning({...})` collapses to the
 * no-arg `returning()` overload. Both Neon drivers are schema-identical at
 * runtime; narrow to the HTTP client's static type only for typing.
 */
export function narrowDbForDrizzleReturning(db: AnyDbClient): DbClient {
  return db as unknown as DbClient
}

export function narrowTxForDrizzleReturning(tx: AnyDbTransaction): DbTransaction {
  return tx as unknown as DbTransaction
}

// ---------------------------------------------------------------------------
// Drizzle utility re-exports
// Workers must import these from here (not from 'drizzle-orm' directly) to
// guarantee they use the same drizzle-orm instance as the schema tables.
// ---------------------------------------------------------------------------

export {
  sql,
  eq,
  ne,
  and,
  or,
  isNull,
  isNotNull,
  lt,
  lte,
  gt,
  gte,
  inArray,
  notInArray,
  asc,
  desc,
  not,
  exists,
  count,
} from 'drizzle-orm'
