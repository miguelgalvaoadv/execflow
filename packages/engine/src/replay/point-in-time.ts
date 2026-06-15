/**
 * Point-in-time replay — historical legal state reconstruction.
 *
 * Answers the question: "What would the engine have concluded on date X,
 * given the information that was available and confirmed at that time?"
 *
 * REPLAY SEMANTICS:
 * - Uses the playbook version that was effective at asOfDate (not current)
 * - Loads only snapshots/events that were confirmed BEFORE asOfDate
 * - Does NOT write new Opportunities or Deadlines
 * - Returns a ReplayBundle for display/audit purposes only
 *
 * DETERMINISM CHECK:
 * If the replay is run for the same parameters as an existing EngineRun,
 * the ruleTraces.outputsHash values MUST match. Any mismatch indicates
 * a non-determinism bug in the evaluator code.
 *
 * Architecture ref: execution-engine.md §7 (historical replay).
 */

import type { AnyDbClient } from '@execflow/db/client'
import { eq, and, lte, desc, narrowDbForDrizzleReturning } from '@execflow/db/client'
import { engineRuns, engineRuleTraces } from '@execflow/db/schema'
import type { ReplayBundle, ReplayRequest } from '../types/index.ts'
import { runEvaluation } from '../runtime/runner.ts'

/**
 * Performs a point-in-time historical replay.
 *
 * IMPORTANT: replay results are NOT committed as new Opportunities.
 * The returned ReplayBundle is for display/audit use only.
 *
 * Architecture ref: execution-engine.md §7.1 ("What was the legal state on date X?")
 */
export async function replayAtPointInTime(
  db: AnyDbClient,
  request: ReplayRequest
): Promise<ReplayBundle> {
  const client = narrowDbForDrizzleReturning(db)
  const { organizationId, executionCaseId, asOfDate, useHistoricalPlaybook } = request

  // Run evaluation at the historical instant (reads-only from DB, no writes)
  const { result, ctx: _ctx } = await runEvaluation(client, {
    organizationId,
    executionCaseId,
    evaluatedAt: asOfDate,
    jurisdictionScope: 'BR-FED',
    trigger: 'manual',
    isReplay: true,
  })

  // Check consistency against existing engine run for same case/date if available
  const consistentWithCurrent = await checkReplayConsistency(
    client,
    organizationId,
    executionCaseId,
    asOfDate,
    result.ruleTraces
  )

  // Use the actual facts loaded during the historical run
  const facts = _ctx.facts

  return {
    asOfDate,
    playbookVersionId: result.playbookVersionId,
    facts,
    runResult: result,
    consistentWithCurrent,
  }
}

/**
 * Checks replay consistency: compares outputsHashes from the replay
 * against the stored hashes from a prior engine run for the same case.
 *
 * Returns null if no prior run exists for comparison.
 */
async function checkReplayConsistency(
  db: AnyDbClient,
  organizationId: string,
  executionCaseId: string,
  asOfDate: Date,
  replayTraces: Array<{ ruleId: string; outputsHash: string }>
): Promise<boolean | null> {
  const client = narrowDbForDrizzleReturning(db)
  // Find the most recent completed engine run for this case at or before asOfDate
  const [priorRun] = await client
    .select({ id: engineRuns.id })
    .from(engineRuns)
    .where(
      and(
        eq(engineRuns.organizationId, organizationId),
        eq(engineRuns.executionCaseId, executionCaseId),
        eq(engineRuns.status, 'completed'),
        lte(engineRuns.evaluatedAt, asOfDate)
      )
    )
    .orderBy(desc(engineRuns.evaluatedAt))
    .limit(1)

  if (priorRun === undefined) return null

  // Load the stored traces for that run
  const storedTraces = await client
    .select({ ruleId: engineRuleTraces.ruleId, outputsHash: engineRuleTraces.outputsHash })
    .from(engineRuleTraces)
    .where(eq(engineRuleTraces.engineRunId, priorRun.id))

  // Build maps for comparison
  const storedMap = new Map<string, string>(storedTraces.map((t: any) => [t.ruleId, t.outputsHash]))
  const replayMap = new Map<string, string>(replayTraces.map((t: any) => [t.ruleId, t.outputsHash]))

  // Check: every ruleId in the stored run must produce the same outputsHash in replay
  for (const [ruleId, storedHash] of storedMap) {
    const replayHash = replayMap.get(ruleId)
    if (replayHash !== undefined && replayHash !== storedHash) {
      return false // Non-determinism detected!
    }
  }

  return true
}
