/**
 * Engine event consumers — react to domain events that trigger legal computation.
 *
 * These consumers are the entry points for the legal computation engine.
 * They:
 * 1. Receive domain events from pg-boss
 * 2. Invalidate stale dependencies in the engine
 * 3. Schedule RecalculationRuns for affected cases
 * 4. Trigger new engine evaluations when appropriate
 *
 * IDEMPOTENCY:
 * Each consumer checks whether a recalculation has already been scheduled
 * for the same trigger entity to avoid duplicate runs.
 *
 * ARCHITECTURE:
 * Most reactions schedule RecalculationRun rows + dependency invalidation.
 * `engine.evaluation.requested` additionally runs evaluation inline when used.
 *
 * Architecture ref: execution-engine.md §1.6 (recalculation events),
 *                   event-state-architecture.md §3 (transactional outbox).
 */

import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import { eq, and } from '@execflow/db/client'
import { recalculationRuns } from '@execflow/db/schema'
import {
  invalidateDependencies,
  scheduleRecalculation,
  runEvaluation,
  commitEngineRun,
  failEngineRun,
} from '@execflow/engine'
import { randomUUID } from 'crypto'

/** pg-boss job envelope published by outbox relay (packages/workers/src/outbox/relay.ts). */
type RelayJobEnvelope = {
  payload?: Record<string, unknown>
  organizationId?: string | null
  correlationId?: string
}

/**
 * Normalizes outbox-originated jobs: domain fields live under `payload`;
 * `organizationId` is duplicated at the envelope root by the relay.
 */
function parseRelayEnvelope(job: Job<unknown>): {
  organizationId: string
  payload: Record<string, unknown>
  correlationId: string | null
} | null {
  const d = job.data as RelayJobEnvelope
  const payload =
    d.payload !== undefined && typeof d.payload === 'object' && d.payload !== null
      ? d.payload
      : {}
  const organizationId =
    typeof d.organizationId === 'string'
      ? d.organizationId
      : typeof payload['organizationId'] === 'string'
        ? payload['organizationId']
        : null
  if (organizationId === null) return null
  return {
    organizationId,
    payload,
    correlationId: typeof d.correlationId === 'string' ? d.correlationId : null,
  }
}

function str(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key]
  return typeof v === 'string' ? v : undefined
}

// ---------------------------------------------------------------------------
// SentenceSnapshot superseded → invalidate dependencies + schedule recalculation
// ---------------------------------------------------------------------------

export async function handleSentenceSnapshotSuperseded(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseRelayEnvelope(job)
  if (env === null) {
    console.warn('[engine-events] handleSentenceSnapshotSuperseded: missing organization', job.id)
    return
  }
  const { organizationId, payload, correlationId } = env
  const executionCaseId =
    str(payload, 'executionCaseId') ??
    str(payload, 'execution_case_id')
  const snapshotId =
    str(payload, 'snapshotId') ??
    str(payload, 'supersededSnapshotId') ??
    str(payload, 'oldSnapshotId')
  const reason =
    str(payload, 'reason') ??
    str(payload, 'supersededReason') ??
    'sentence snapshot superseded'
  if (executionCaseId === undefined || snapshotId === undefined) {
    console.warn('[engine-events] handleSentenceSnapshotSuperseded: invalid payload', job.id)
    return
  }

  console.info(
    `[engine-events] Sentence snapshot superseded for case ${executionCaseId} (snapshot: ${snapshotId})`
  )

  // Invalidate dependencies pointing to the old snapshot
  const affectedCaseIds = await invalidateDependencies(db, {
    dependencyType: 'sentence_snapshot',
    dependencyEntityId: snapshotId,
    changeReason: `Snapshot superseded: ${reason}`,
  })

  // Ensure the case itself is in the affected list (even if no prior run)
  const caseIds = new Set([...affectedCaseIds, executionCaseId])

  // Schedule recalculation for each affected case
  for (const caseId of caseIds) {
    // Idempotency: check if recalculation already scheduled for this trigger
    const [existing] = await db
      .select({ id: recalculationRuns.id })
      .from(recalculationRuns)
      .where(
        and(
          eq(recalculationRuns.executionCaseId, caseId),
          eq(recalculationRuns.triggerEntityId, snapshotId),
          eq(recalculationRuns.status, 'scheduled')
        )
      )
      .limit(1)

    if (existing !== undefined) {
      console.info(
        `[engine-events] Recalculation already scheduled for case ${caseId} (skipping duplicate)`
      )
      continue
    }

    await scheduleRecalculation(db, {
      organizationId,
      executionCaseId: caseId,
      triggerEntityType: 'sentence_snapshot',
      triggerEntityId: snapshotId,
      triggerReason: `SentenceSnapshot superseded: ${reason}`,
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
    })
  }
}

// ---------------------------------------------------------------------------
// CustodySnapshot created → invalidate dependencies + schedule recalculation
// ---------------------------------------------------------------------------

export async function handleCustodySnapshotCreated(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseRelayEnvelope(job)
  if (env === null) {
    console.warn('[engine-events] handleCustodySnapshotCreated: missing organization', job.id)
    return
  }
  const { organizationId, payload, correlationId } = env
  const executionCaseId =
    str(payload, 'executionCaseId') ?? str(payload, 'execution_case_id')
  const snapshotId =
    str(payload, 'snapshotId') ??
    str(payload, 'custodySnapshotId')
  const regime =
    str(payload, 'regime') ??
    str(payload, 'custodyRegime') ??
    'unknown'
  if (executionCaseId === undefined || snapshotId === undefined) {
    console.warn('[engine-events] handleCustodySnapshotCreated: invalid payload', job.id)
    return
  }

  console.info(
    `[engine-events] Custody snapshot created for case ${executionCaseId} (regime: ${regime})`
  )

  // Invalidate dependencies pointing to prior custody snapshots for this case
  const affectedCaseIds = await invalidateDependencies(db, {
    dependencyType: 'custody_snapshot',
    dependencyEntityId: snapshotId,
    changeReason: `New custody snapshot created (regime: ${regime})`,
  })

  const caseIds = new Set([...affectedCaseIds, executionCaseId])

  for (const caseId of caseIds) {
    const [existing] = await db
      .select({ id: recalculationRuns.id })
      .from(recalculationRuns)
      .where(
        and(
          eq(recalculationRuns.executionCaseId, caseId),
          eq(recalculationRuns.triggerEntityId, snapshotId),
          eq(recalculationRuns.status, 'scheduled')
        )
      )
      .limit(1)

    if (existing !== undefined) continue

    await scheduleRecalculation(db, {
      organizationId,
      executionCaseId: caseId,
      triggerEntityType: 'custody_snapshot',
      triggerEntityId: snapshotId,
      triggerReason: `CustodySnapshot created (regime: ${regime})`,
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
    })
  }
}

// ---------------------------------------------------------------------------
// TimelineEvent appended → dependency invalidation + conditional recalculation
// ---------------------------------------------------------------------------

const ENGINE_TRIGGERING_EVENTS = new Set([
  'disciplinary.sanction',
  'discipline.falta_grave',
  'prison.escape',
  'custody.escape',
  'prison.recapture',
  'custody.recapture',
  'sentence.unification',
  'benefit.revoked',
  'benefit.granted',
  'sentence.recalculation_done',
  'remission.credit',
  'detraction.applied',
])

export async function handleTimelineEventForEngine(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseRelayEnvelope(job)
  if (env === null) {
    console.warn('[engine-events] handleTimelineEventForEngine: missing organization', job.id)
    return
  }
  const { organizationId, payload, correlationId } = env
  const executionCaseId =
    str(payload, 'executionCaseId') ?? str(payload, 'execution_case_id')
  const timelineEventId =
    str(payload, 'timelineEventId') ??
    str(payload, 'timeline_event_id')
  const eventType = str(payload, 'eventType') ?? str(payload, 'event_type')
  if (executionCaseId === undefined || timelineEventId === undefined || eventType === undefined) {
    console.warn('[engine-events] handleTimelineEventForEngine: invalid payload', job.id)
    return
  }

  // Only react to events that materially affect legal computation
  if (!ENGINE_TRIGGERING_EVENTS.has(eventType)) {
    return
  }

  console.info(
    `[engine-events] Engine-triggering timeline event: ${eventType} for case ${executionCaseId}`
  )

  await invalidateDependencies(db, {
    dependencyType: 'timeline_event',
    dependencyEntityId: timelineEventId,
    changeReason: `Timeline event appended: ${eventType}`,
  })

  const [existing] = await db
    .select({ id: recalculationRuns.id })
    .from(recalculationRuns)
    .where(
      and(
        eq(recalculationRuns.executionCaseId, executionCaseId),
        eq(recalculationRuns.triggerEntityId, timelineEventId),
        eq(recalculationRuns.status, 'scheduled')
      )
    )
    .limit(1)

  if (existing !== undefined) return

  await scheduleRecalculation(db, {
    organizationId,
    executionCaseId,
    triggerEntityType: 'timeline_event',
    triggerEntityId: timelineEventId,
    triggerReason: `Timeline event appended: ${eventType}`,
    parentRecalculationRunId: null,
    chainDepth: 0,
    correlationId,
  })
}

// ---------------------------------------------------------------------------
// Document associated → stale opportunity propagation + dependency invalidation
// ---------------------------------------------------------------------------

export async function handleDocumentAssociatedForEngine(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseRelayEnvelope(job)
  if (env === null) {
    console.warn('[engine-events] handleDocumentAssociatedForEngine: missing organization', job.id)
    return
  }
  const { organizationId, payload, correlationId } = env
  const documentId = str(payload, 'documentId')
  if (documentId === undefined) {
    console.warn('[engine-events] handleDocumentAssociatedForEngine: invalid payload', job.id)
    return
  }

  const executionCaseId = str(payload, 'executionCaseId')
  const documentClass =
    str(payload, 'documentClass') ?? str(payload, 'document_class')

  const affectedCaseIds = await invalidateDependencies(db, {
    dependencyType: 'document',
    dependencyEntityId: documentId,
    changeReason: `Document associated: class=${documentClass ?? 'unknown'}`,
  })

  if (affectedCaseIds.length === 0 && executionCaseId === undefined) return

  const caseIds = new Set([
    ...affectedCaseIds,
    ...(executionCaseId !== undefined ? [executionCaseId] : []),
  ])

  const legallySignificantClasses = new Set([
    'sentenca',
    'despacho',
    'certidao',
    'guia',
    'remicao',
    'detracao',
  ])

  if (documentClass === undefined || !legallySignificantClasses.has(documentClass)) {
    return
  }

  for (const caseId of caseIds) {
    await scheduleRecalculation(db, {
      organizationId,
      executionCaseId: caseId,
      triggerEntityType: 'document',
      triggerEntityId: documentId,
      triggerReason: `Document associated: class=${documentClass}`,
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
    })
  }
}
// ---------------------------------------------------------------------------
// Engine evaluation requested → runs evaluation and commits result
// ---------------------------------------------------------------------------

type EngineEvaluationRequestedPayload = {
  organizationId: string
  executionCaseId: string
  jurisdictionScope: string
  trigger: string
  triggerEntityType?: string
  triggerEntityId?: string
  requestedByUserId?: string
  correlationId?: string
  recalculationRunId?: string
}

export async function handleEngineEvaluationRequested(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const data = job.data as EngineEvaluationRequestedPayload
  if (
    typeof data.organizationId !== 'string' ||
    typeof data.executionCaseId !== 'string'
  ) {
    console.warn('[engine-events] handleEngineEvaluationRequested: invalid payload', job.id)
    return
  }

  const runId = randomUUID()

  try {
    console.info(
      `[engine-events] Running evaluation for case ${data.executionCaseId} (trigger: ${data.trigger})`
    )

    // Run the full evaluation (pure computation, reads DB)
    const result = await runEvaluation(db, {
      runId,
      organizationId: data.organizationId,
      executionCaseId: data.executionCaseId,
      evaluatedAt: new Date(),
      jurisdictionScope: data.jurisdictionScope ?? 'BR-FED',
      trigger: data.trigger ?? 'manual',
    })

    // Commit result to DB (creates EngineRun, Opportunities, ExplanationBundles)
    const committedRunId = await commitEngineRun(
      db,
      {
        runId,
        organizationId: data.organizationId,
        executionCaseId: data.executionCaseId,
        evaluatedAt: result.evaluatedAt,
        playbook: {
          playbookVersionId: result.playbookVersionId,
          overlayVersionId: null,
          caseContextId: null,
          strategyProfile: 'standard',
          jurisdictionScope: 'BR-FED',
          effectiveAt: result.evaluatedAt,
          groups: [],
          ruleMap: new Map(),
        },
        facts: {
          organizationId: data.organizationId,
          executionCaseId: data.executionCaseId,
          evaluatedAt: result.evaluatedAt,
          sentence: null,
          custody: null,
          activeInterruptions: [],
          recentEvents: [],
          hasConfirmedProcessNumber: true,
          hasRecentConfirmedSnapshot: false,
        },
        globalBlockingCodes: [],
      },
      result,
      {
        trigger: (data.trigger ?? 'manual') as typeof import('@execflow/db/schema').engineRuns.$inferInsert['trigger'],
        triggerEntityType: data.triggerEntityType,
        triggerEntityId: data.triggerEntityId,
        requestedByUserId: data.requestedByUserId,
        isReplay: false,
      }
    )

    console.info(
      `[engine-events] Evaluation completed for case ${data.executionCaseId} (run: ${committedRunId}, ${result.opportunityProposals.length} opportunities)`
    )
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(
      `[engine-events] Evaluation failed for case ${data.executionCaseId}: ${errorMsg}`
    )
    await failEngineRun(db, runId, errorMsg)
    throw err
  }
}
