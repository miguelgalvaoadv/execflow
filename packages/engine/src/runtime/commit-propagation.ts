/**
 * Transactional outbox writes for engine commit — connects evaluation persistence
 * to the platform domain_events → relay → pg-boss propagation chain.
 *
 * Emits:
 * - opportunity.created — one per persisted Opportunity (same contract as manual
 *   opportunity creation consumers; queue name mirrors domain_events.event_type).
 * - engine.run.completed — one per finished EngineRun (non-replay only).
 *
 * Replay runs (isReplay): emit nothing — avoids operational side effects during replay.
 *
 * Architecture ref: event-state-architecture.md §4.1 (transactional outbox),
 *                   execution-engine.md §9 (engine outputs catalog).
 */

import type { DbTransaction } from '@execflow/db/client'
import { domainEvents } from '@execflow/db/schema'
import type { EngineRunResult } from '../types/index.ts'
import type { CommitOptions } from './commit-options.ts'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function correlationUuid(runId: string, propagation?: CommitOptions['propagation']): string {
  const candidate = propagation?.correlationId?.trim()
  if (candidate !== undefined && candidate !== '' && UUID_RE.test(candidate)) {
    return candidate
  }
  return runId
}

/**
 * Inserts domain_events rows inside the engine commit transaction.
 * Caller guarantees: non-replay, transaction still open.
 */
export async function emitEngineCommitDomainEvents(
  t: DbTransaction,
  params: {
    runId: string
    result: EngineRunResult
    opts: CommitOptions
    /** Opportunity IDs in the same order as result.opportunityProposals */
    createdOpportunityIds: string[]
  }
): Promise<void> {
  const { runId, result, opts, createdOpportunityIds } = params

  if (opts.isReplay) return

  const correlationId = correlationUuid(runId, opts.propagation)
  const actorType = opts.requestedByUserId !== undefined ? 'user' : 'system'
  const actorId = opts.requestedByUserId ?? 'execflow-engine'

  const metadata: Record<string, unknown> = { engineRunId: runId }
  const reqId = opts.propagation?.requestId
  if (reqId !== undefined && reqId !== '') metadata['requestId'] = reqId

  const proposals = result.opportunityProposals
  if (createdOpportunityIds.length !== proposals.length) {
    throw new Error(
      `[engine/commit-propagation] Opportunity id count (${createdOpportunityIds.length}) does not match proposals (${proposals.length}).`
    )
  }

  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i]!
    const opportunityId = createdOpportunityIds[i]!

    await t.insert(domainEvents).values({
      eventType: 'opportunity.created',
      aggregateType: 'Opportunity',
      aggregateId: opportunityId,
      causationId: null,
      correlationId,
      organizationId: result.organizationId,
      actorType,
      actorId,
      occurredAt: result.evaluatedAt,
      payload: {
        opportunityId,
        executionCaseId: result.executionCaseId,
        organizationId: result.organizationId,
        opportunityType: proposal.opportunityType,
        status: 'suggested',
        confidenceLevel: proposal.confidenceLevel,
        summary: proposal.summary,
        windowStartAt:
          proposal.windowStartAt !== undefined && proposal.windowStartAt !== null
            ? proposal.windowStartAt.toISOString()
            : null,
        windowEndAt:
          proposal.windowEndAt !== undefined && proposal.windowEndAt !== null
            ? proposal.windowEndAt.toISOString()
            : null,
        engineRunId: runId,
        source: 'engine',
      },
      metadata,
      replayable: true,
      processingStatus: 'pending',
    })
  }

  await t.insert(domainEvents).values({
    eventType: 'engine.run.completed',
    aggregateType: 'EngineRun',
    aggregateId: runId,
    causationId: null,
    correlationId,
    organizationId: result.organizationId,
    actorType,
    actorId,
    occurredAt: result.evaluatedAt,
    payload: {
      engineRunId: runId,
      executionCaseId: result.executionCaseId,
      organizationId: result.organizationId,
      playbookVersionId: result.playbookVersionId,
      evaluatedAt: result.evaluatedAt.toISOString(),
      opportunityIds: createdOpportunityIds,
      opportunityCount: createdOpportunityIds.length,
      globalBlockingCodes: result.globalBlockingCodes,
      trigger: opts.trigger,
      warningsEmitted: result.warnings.map((w) => w.code),
      source: 'engine',
    },
    metadata,
    replayable: true,
    processingStatus: 'pending',
  })
}
