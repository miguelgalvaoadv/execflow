/**
 * @execflow/db — root export.
 *
 * Consumers should prefer the subpath imports for tree-shaking:
 *   import { organizations } from '@execflow/db/schema'
 *   import { createDbClient } from '@execflow/db/client'
 *   import type { Organization } from '@execflow/db/types'
 *
 * This root barrel re-exports the most commonly needed symbols for convenience.
 */

export { createDbClient } from './client/index.ts'
export type { DbClient, DbTransaction } from './client/index.ts'

export * from './schema/index.ts'
export * from './types/index.ts'
