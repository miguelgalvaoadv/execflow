/**
 * Database client singleton for apps/api.
 *
 * Created once at startup from DATABASE_URL environment variable.
 * Injected into auth, middleware, and service functions as a dependency.
 *
 * Never import this in packages/* — those receive the client as a parameter.
 * Only app-level code (apps/api, apps/workers) instantiates the client.
 */

import { createDbClient } from '@execflow/db/client'
import type { DbClient, DbTransaction } from '@execflow/db/client'

const url = process.env['DATABASE_URL']

if (!url) {
  throw new Error(
    '[apps/api] DATABASE_URL is required. ' +
    'Copy .env.example to .env.local and set the Neon connection string.'
  )
}

export const db = createDbClient(url)
export type { DbClient, DbTransaction } from '@execflow/db/client'

/**
 * Union type: any context that supports Drizzle query operations.
 * Pass this type to repository functions that must work both inside
 * and outside a transaction (reads). Write functions should accept
 * DbTransaction to enforce transactional context.
 */
export type AnyTx = DbClient | DbTransaction
