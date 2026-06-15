/**
 * ReadContext — shared context for read-only service functions.
 * Reuses WriteContext shape (db, actor, organizationId) without implying a write.
 */

import type { WriteContext } from './write-context.ts'

export type ReadContext = Pick<
  WriteContext,
  'db' | 'actor' | 'organizationId' | 'userId'
>

export function toReadContext(ctx: WriteContext): ReadContext {
  return {
    db: ctx.db,
    actor: ctx.actor,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  }
}
