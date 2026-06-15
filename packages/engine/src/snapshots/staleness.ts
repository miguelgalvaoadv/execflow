/**
 * Staleness detection and dependency invalidation.
 *
 * When a dependency changes, engine runs that depended on it become stale.
 * Stale runs should be recalculated to ensure Opportunities are current.
 *
 * This module provides:
 * - Finding engine runs affected by a changed dependency
 * - Marking dependencies as stale
 * - Detecting if a case needs recalculation
 *
 * Architecture ref: execution-engine.md §1.6 (recalculation events),
 *                   Phase 7 snapshot_dependencies.is_stale.
 */

import { eq, and, inArray, narrowDbForDrizzleReturning } from '@execflow/db/client'
import type { AnyDbClient } from '@execflow/db/client'
import { snapshotDependencies, engineRuns } from '@execflow/db/schema'

export type DependencyChangeEvent = {
  dependencyType:
    | 'sentence_snapshot'
    | 'custody_snapshot'
    | 'timeline_event'
    | 'document'
    | 'playbook_version'
  dependencyEntityId: string
  changeReason: string
}

/**
 * Finds all engine runs affected by a dependency change and marks them stale.
 *
 * Returns the list of affected executionCaseIds so callers can
 * schedule RecalculationRuns for each.
 *
 * Architecture ref: execution-engine.md §1.6.
 */
export async function invalidateDependencies(
  db: AnyDbClient,
  change: DependencyChangeEvent
): Promise<string[]> {
  const client = narrowDbForDrizzleReturning(db)
  const { dependencyType, dependencyEntityId, changeReason } = change

  // Find all non-stale dependencies pointing to this entity
  const affectedDeps = await client
    .select({
      id: snapshotDependencies.id,
      engineRunId: snapshotDependencies.engineRunId,
    })
    .from(snapshotDependencies)
    .where(
      and(
        eq(snapshotDependencies.dependencyType, dependencyType),
        eq(snapshotDependencies.dependencyEntityId, dependencyEntityId),
        eq(snapshotDependencies.isStale, false)
      )
    )

  if (affectedDeps.length === 0) return []

  // Mark each dependency as stale
  const now = new Date()
  for (const dep of affectedDeps) {
    await client
      .update(snapshotDependencies)
      .set({
        isStale: true,
        staledAt: now,
        staleReason: changeReason,
      })
      .where(eq(snapshotDependencies.id, dep.id))
  }

  const affectedRunIds = [...new Set(affectedDeps.map((d: any) => d.engineRunId as string))]
  if (affectedRunIds.length === 0) return []

  const affectedCases = await client
    .select({
      executionCaseId: engineRuns.executionCaseId,
    })
    .from(engineRuns)
    .where(inArray(engineRuns.id, affectedRunIds as string[]))

  const caseIds = [...new Set(affectedCases.map((r: any) => r.executionCaseId))]

  return caseIds as string[]
}

/**
 * Checks if a specific case has any stale engine run dependencies.
 * Used by the SLA sweep to identify cases needing recalculation.
 */
export async function hasStaleDependencies(
  db: AnyDbClient,
  executionCaseId: string
): Promise<boolean> {
  const client = narrowDbForDrizzleReturning(db)
  const [staleRun] = await client
    .select({ id: snapshotDependencies.id })
    .from(snapshotDependencies)
    .innerJoin(engineRuns, eq(snapshotDependencies.engineRunId, engineRuns.id))
    .where(
      and(
        eq(engineRuns.executionCaseId, executionCaseId),
        eq(snapshotDependencies.isStale, true)
      )
    )
    .limit(1)

  return staleRun !== undefined
}
