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
 * Invalidation consumers schedule RecalculationRun rows + engine.evaluation.requested
 * (transactional outbox). The relay publishes to pg-boss; handleEngineEvaluationRequested
 * runs evaluation, commits, and closes the recalculation lifecycle.
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
  startRecalculation,
  completeRecalculation,
  failRecalculation,
  runMvpEngine,
} from '@execflow/engine'
import { randomUUID } from 'crypto'

/** pg-boss job envelope published by outbox relay (packages/workers/src/outbox/relay.ts). */
type RelayJobEnvelope = {
  eventId?: string
  payload?: Record<string, unknown>
  organizationId?: string | null
  correlationId?: string
  causationId?: string | null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Normalizes outbox-originated jobs: domain fields live under `payload`;
 * `organizationId` is duplicated at the envelope root by the relay.
 */
function parseRelayEnvelope(job: Job<unknown>): {
  organizationId: string
  payload: Record<string, unknown>
  correlationId: string | null
  causationId: string | null
  eventId: string | null
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
    causationId: typeof d.causationId === 'string' ? d.causationId : null,
    eventId: typeof d.eventId === 'string' ? d.eventId : null,
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
  const { organizationId, payload, correlationId, eventId } = env
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
      causationId: eventId,
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
  const { organizationId, payload, correlationId, eventId } = env
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
      causationId: eventId,
    })
  }
}

// ---------------------------------------------------------------------------
// Snapshot confirmed → invalidate dependencies + schedule recalculation
// ---------------------------------------------------------------------------

export async function handleSnapshotConfirmed(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseRelayEnvelope(job)
  if (env === null) {
    console.warn('[engine-events] handleSnapshotConfirmed: missing organization', job.id)
    return
  }
  const { organizationId, payload, correlationId, eventId } = env
  const snapshotId = str(payload, 'snapshotId')
  const executionCaseId = str(payload, 'executionCaseId') ?? str(payload, 'execution_case_id')
  const snapshotKind = str(payload, 'snapshotKind') ?? str(payload, 'snapshot_kind')

  if (snapshotId === undefined || executionCaseId === undefined || snapshotKind === undefined) {
    console.warn('[engine-events] handleSnapshotConfirmed: invalid payload', job.id)
    return
  }

  if (snapshotKind === 'custody') {
    console.info(
      `[engine-events] snapshot.confirmed for custody ${snapshotId} — custody.snapshot.created handles engine`
    )
    return
  }

  if (snapshotKind !== 'sentence') {
    console.warn('[engine-events] handleSnapshotConfirmed: unknown snapshotKind', snapshotKind)
    return
  }

  console.info(
    `[engine-events] Sentence snapshot confirmed for case ${executionCaseId} (snapshot: ${snapshotId})`
  )

  const affectedCaseIds = await invalidateDependencies(db, {
    dependencyType: 'sentence_snapshot',
    dependencyEntityId: snapshotId,
    changeReason: 'Sentence snapshot confirmed via promotion pipeline',
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
      triggerEntityType: 'sentence_snapshot',
      triggerEntityId: snapshotId,
      triggerReason: 'SentenceSnapshot confirmed',
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
      causationId: eventId,
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
  const { organizationId, payload, correlationId, eventId } = env
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
    causationId: eventId,
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
  const { organizationId, payload, correlationId, eventId } = env
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
      causationId: eventId,
    })
  }
}
// ---------------------------------------------------------------------------
// Engine evaluation requested → runs evaluation and commits result
// ---------------------------------------------------------------------------

export async function handleEngineEvaluationRequested(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseRelayEnvelope(job)
  if (env === null) {
    console.warn('[engine-events] handleEngineEvaluationRequested: missing organization', job.id)
    return
  }

  const { organizationId, payload, correlationId } = env
  const executionCaseId =
    str(payload, 'executionCaseId') ?? str(payload, 'execution_case_id')
  const recalculationRunId = str(payload, 'recalculationRunId')
  const trigger = str(payload, 'trigger') ?? 'manual'
  const jurisdictionScope = str(payload, 'jurisdictionScope') ?? 'BR-FED'
  const triggerEntityType = str(payload, 'triggerEntityType')
  const triggerEntityId = str(payload, 'triggerEntityId')
  const requestedByUserId = str(payload, 'requestedByUserId')

  if (executionCaseId === undefined) {
    console.warn('[engine-events] handleEngineEvaluationRequested: invalid payload', job.id)
    return
  }

  if (recalculationRunId !== undefined) {
    const [existingRun] = await db
      .select({
        id: recalculationRuns.id,
        status: recalculationRuns.status,
      })
      .from(recalculationRuns)
      .where(eq(recalculationRuns.id, recalculationRunId))
      .limit(1)

    if (existingRun === undefined) {
      console.warn(
        `[engine-events] handleEngineEvaluationRequested: recalculation run ${recalculationRunId} not found`,
        job.id
      )
      return
    }

    if (
      existingRun.status === 'completed' ||
      existingRun.status === 'skipped' ||
      existingRun.status === 'failed'
    ) {
      console.info(
        `[engine-events] Recalculation run ${recalculationRunId} already terminal (${existingRun.status}), skipping`
      )
      return
    }

    if (existingRun.status === 'running') {
      console.info(
        `[engine-events] Recalculation run ${recalculationRunId} already running, skipping duplicate delivery`
      )
      return
    }

    await startRecalculation(db, recalculationRunId)
  }

  const runId = randomUUID()

  try {
    // MVP E2E PIVOT: Injecting the new ProgressionEvaluator pipeline directly here
    console.info(
      `[engine-events] Running MVP Evaluation for case ${executionCaseId} (trigger: ${trigger})`
    )

    const oppIds = await runMvpEngine(db, executionCaseId, organizationId)
    const committedRunId = runId // keep runId for logs

    if (recalculationRunId !== undefined) {
      await completeRecalculation(db, recalculationRunId, {
        producedEngineRunId: committedRunId,
        materialChangeDetected: oppIds.length > 0,
      })
    }

    console.info(
      `[engine-events] Evaluation completed for case ${executionCaseId} (run: ${committedRunId}, ${oppIds.length} opportunities)`
    )
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(
      `[engine-events] Evaluation failed for case ${executionCaseId}: ${errorMsg}`
    )
    if (recalculationRunId !== undefined) {
      await failRecalculation(db, recalculationRunId, errorMsg)
    }
    // Note: runMvpEngine manages its own EngineRun lifecycle internally.
    // failEngineRun is only applicable when using the full commitEngineRun path.
    throw err
  }
}

// ---------------------------------------------------------------------------
// Engine run completed — observability hook (relay publishes flat job envelope)
// ---------------------------------------------------------------------------

/**
 * Acknowledges `engine.run.completed` after outbox relay publication.
 * Intentionally minimal: no queue mutations here — downstream workflows can subscribe later.
 */
export async function handleEngineRunCompleted(_db: WorkersDb, job: Job<unknown>): Promise<void> {
  const env = parseRelayEnvelope(job)
  if (env === null) {
    console.warn('[engine-events] handleEngineRunCompleted: missing organization', job.id)
    return
  }
  const runId = str(env.payload, 'engineRunId')
  if (runId === undefined) {
    console.warn('[engine-events] handleEngineRunCompleted: invalid payload', job.id)
    return
  }
  console.info(
    `[engine-events] engine.run.completed run=${runId} org=${env.organizationId} correlation=${env.correlationId ?? 'none'}`
  )
}
