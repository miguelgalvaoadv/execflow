/**
 * Database client for long-running worker processes.
 *
 * Workers use the Pool-based Neon WebSocket driver (via @execflow/db's
 * createPoolDbClient) rather than the HTTP driver used by apps/api. This
 * supports real transactions with FOR UPDATE SKIP LOCKED (needed by the
 * transactional outbox relay) and connection pooling for sustained throughput.
 *
 * CRITICAL: Workers MUST NOT install drizzle-orm as a direct dependency.
 * All drizzle types and utilities must come from @execflow/db to guarantee
 * a single drizzle-orm type instance across the monorepo. Two drizzle
 * instances cause TypeScript type incompatibilities with schema tables.
 *
 * Architecture ref: technical-stack-decision.md §2.3 (worker architecture).
 */

import ws from 'ws'
import { neonConfig } from '@neondatabase/serverless'
import { createPoolDbClient } from '@execflow/db/client'
import type { PoolDbClient, PoolDbTransaction } from '@execflow/db/client'

// Configure the WebSocket constructor once at module load.
// Must happen before any Pool is created.
neonConfig.webSocketConstructor = ws

/**
 * Creates a Drizzle Pool-based database client for worker processes.
 * Call once at worker process startup.
 *
 * @param connectionString - Same DATABASE_URL as apps/api.
 */
export function createWorkersDb(connectionString: string): PoolDbClient {
  return createPoolDbClient(connectionString)
}

/**
 * The TypeScript type of the workers' Drizzle client.
 * Uses @execflow/db's PoolDbClient — guaranteed same drizzle-orm instance.
 */
export type WorkersDb = PoolDbClient

/**
 * The TypeScript type for a Drizzle transaction in the workers context.
 */
export type WorkersTx = PoolDbTransaction
