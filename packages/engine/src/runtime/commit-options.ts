/**
 * Options for persisting an EngineRun — shared by commit + transactional propagation.
 */

import type { engineRuns } from '@execflow/db/schema'

export type CommitPropagationContext = {
  /** UUID shared by all domain_events emitted for this commit (defaults to EngineRun id). */
  correlationId: string
  requestId?: string | undefined
}

export type CommitOptions = {
  trigger: typeof engineRuns.$inferInsert['trigger']
  triggerEntityType?: string | undefined
  triggerEntityId?: string | undefined
  requestedByUserId?: string | undefined
  isReplay: boolean
  overlayVersionId?: string | undefined
  caseContextId?: string | undefined
  /**
   * HTTP / worker callers attach tracing context so domain_events.metadata.correlation_id chain matches platform conventions.
   */
  propagation?: CommitPropagationContext | undefined
}
