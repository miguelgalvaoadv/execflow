/**
 * Recalculation propagation — schedules and tracks recalculation runs.
 *
 * When a dependency changes (snapshot superseded, event appended, playbook published),
 * the engine must schedule recalculation for all affected cases. This module:
 *
 * 1. Creates RecalculationRun records for affected cases
 * 2. Enforces maximum chain depth (prevents infinite loops)
 * 3. Detects whether recalculation is necessary (skips if no material change)
 *
 * CHAIN DEPTH PROTECTION:
 * A recalculation cascade is capped at MAX_CHAIN_DEPTH. If a recalculation
 * at depth N would trigger another, it is skipped and a warning is emitted.
 * This prevents runaway chains from circular dependencies.
 *
 * Architecture ref: execution-engine.md §1.6 (recalculation events).
 */

import type { AnyDbClient } from '@execflow/db/client'
import { eq, narrowDbForDrizzleReturning } from '@execflow/db/client'
import { recalculationRuns } from '@execflow/db/schema'
import type { RecalculationRequest } from '../types/index.ts'

const MAX_CHAIN_DEPTH = 10

/**
 * Schedules a recalculation run for a case.
 * Returns the created recalculation run ID, or null if depth limit exceeded.
 *
 * Callers: event consumers (workers) after snapshot supersession or event append.
 */
export async function scheduleRecalculation(
  db: AnyDbClient,
  request: RecalculationRequest
): Promise<string | null> {
  if (request.chainDepth >= MAX_CHAIN_DEPTH) {
    console.warn(
      `[recalculation] Chain depth limit (${MAX_CHAIN_DEPTH}) exceeded for case ${request.executionCaseId}. Stopping propagation.`
    )
    return null
  }

  const [run] = await narrowDbForDrizzleReturning(db)
    .insert(recalculationRuns)
    .values({
      organizationId: request.organizationId,
      executionCaseId: request.executionCaseId,
      triggerEntityType: request.triggerEntityType,
      triggerEntityId: request.triggerEntityId,
      triggerReason: request.triggerReason,
      parentRecalculationRunId: request.parentRecalculationRunId,
      chainDepth: request.chainDepth,
      status: 'scheduled',
      ...(request.correlationId !== null ? { correlationId: request.correlationId } : {}),
    })
    .returning({ id: recalculationRuns.id })

  return run?.id ?? null
}

/**
 * Marks a recalculation run as started.
 */
export async function startRecalculation(
  db: AnyDbClient,
  recalculationRunId: string
): Promise<void> {
  await db
    .update(recalculationRuns)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(recalculationRuns.id, recalculationRunId))
}

/**
 * Marks a recalculation run as completed with the produced engine run.
 */
export async function completeRecalculation(
  db: AnyDbClient,
  recalculationRunId: string,
  options: {
    producedEngineRunId: string
    materialChangeDetected: boolean
    changeSummary?: {
      opportunitiesAdded: number
      opportunitiesRemoved: number
      snapshotDelta: boolean
    }
  }
): Promise<void> {
  await db
    .update(recalculationRuns)
    .set({
      status: options.materialChangeDetected ? 'completed' : 'skipped',
      producedEngineRunId: options.producedEngineRunId,
      materialChangeDetected: options.materialChangeDetected,
      changeSummary: options.changeSummary ?? null,
      completedAt: new Date(),
    })
    .where(eq(recalculationRuns.id, recalculationRunId))
}

/**
 * Marks a recalculation run as failed.
 */
export async function failRecalculation(
  db: AnyDbClient,
  recalculationRunId: string,
  errorDetails: string
): Promise<void> {
  await db
    .update(recalculationRuns)
    .set({
      status: 'failed',
      errorDetails,
      completedAt: new Date(),
    })
    .where(eq(recalculationRuns.id, recalculationRunId))
}
