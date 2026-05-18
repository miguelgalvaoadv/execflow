/**
 * @execflow/auth — root export.
 *
 * Usage:
 *   import { createAuth } from '@execflow/auth'
 *   import type { RequestActor, SessionUser } from '@execflow/auth/types'
 */

export { createAuth } from './config.ts'
export type { Auth } from './config.ts'
export type { RequestActor, SessionUser, SessionData, SessionResult } from './types.ts'
