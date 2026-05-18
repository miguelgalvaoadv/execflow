/**
 * Engine commit — persists EngineRunResult to the database.
 *
 * The commit step is separated from evaluation to maintain the pure/deterministic
 * character of the evaluator layer. Only after all rules have been evaluated
 * successfully does the commit step write to the database.
 *
 * TRANSACTIONAL COMMIT:
 * All writes happen within a single database transaction:
 * - EngineRun record (status → 'completed')
 * - EngineRuleTrace records (one per evaluated rule)
 * - ExplanationBundle records (one per opportunity proposal + one for run)
 * - SnapshotDependency records (one per input consumed)
 * - Opportunity records (one per proposal, status='suggested')
 *
 * REPLAY RUNS: commit creates EngineRun + traces but NOT Opportunities.
 * Replay is read-only at the legal level.
 *
 * Architecture ref: execution-engine.md §9 (engine outputs catalog).
 */

import type { AnyDbClient } from '@execflow/db/client'
import { eq, narrowTxForDrizzleReturning } from '@execflow/db/client'
import {
  engineRuns,
  engineRuleTraces,
  explanationBundles,
  snapshotDependencies,
  opportunities,
} from '@execflow/db/schema'
import type { EngineRunResult, EvaluationContext } from '../types/index.ts'

export type CommitOptions = {
  trigger: typeof engineRuns.$inferInsert['trigger']
  triggerEntityType?: string | undefined
  triggerEntityId?: string | undefined
  requestedByUserId?: string | undefined
  isReplay: boolean
  overlayVersionId?: string | undefined
  caseContextId?: string | undefined
}

/**
 * Persists the evaluation result to the database within a single transaction.
 *
 * Returns the committed EngineRun ID.
 */
export async function commitEngineRun(
  db: AnyDbClient,
  ctx: EvaluationContext,
  result: EngineRunResult,
  opts: CommitOptions
): Promise<string> {
  return db.transaction(async (tx) => {
    const t = narrowTxForDrizzleReturning(tx)
    // 1. Create EngineRun record (status: running → will update to completed)
    const [runRow] = await t
      .insert(engineRuns)
      .values({
        id: result.runId,
        organizationId: result.organizationId,
        executionCaseId: result.executionCaseId,
        playbookVersionId: result.playbookVersionId,
        overlayVersionId: opts.overlayVersionId ?? null,
        caseContextId: opts.caseContextId ?? null,
        strategyProfile: ctx.playbook.strategyProfile,
        evaluatedAt: result.evaluatedAt,
        startedAt: new Date(),
        status: 'running',
        trigger: opts.trigger,
        triggerEntityType: opts.triggerEntityType ?? null,
        triggerEntityId: opts.triggerEntityId ?? null,
        requestedByUserId: opts.requestedByUserId ?? null,
        uncertaintyLevel: result.overallUncertaintyLevel,
        blockingCodes: result.globalBlockingCodes,
        missingDataSummary: result.missingDataSummary,
        opportunitiesCreated: result.opportunityProposals.map((p) => p.opportunityType),
        warningsEmitted: result.warnings.map((w) => w.code),
        isReplay: opts.isReplay,
      })
      .returning({ id: engineRuns.id })

    if (runRow === undefined) throw new Error('Failed to create EngineRun record')
    const runId = runRow.id

    // 2. Insert rule traces (append-only)
    if (result.ruleTraces.length > 0) {
      await t.insert(engineRuleTraces).values(
        result.ruleTraces.map((trace) => ({
          organizationId: result.organizationId,
          engineRunId: runId,
          ruleId: trace.ruleId,
          playbookVersionId: trace.playbookVersionId,
          evaluatorId: trace.evaluatorId,
          evaluationOrder: trace.evaluationOrder,
          inputsHash: trace.inputsHash,
          outputsHash: trace.outputsHash,
          inputsSnapshot: trace.outputsSnapshot ?? null,
          outputsSnapshot: trace.outputsSnapshot ?? null,
          outcome: trace.outcome,
          uncertaintyLevel: trace.uncertaintyLevel,
          blockingCodes: trace.blockingCodes,
          uncertaintyFactors: trace.uncertaintyFactors,
          missingDataRefs: trace.missingDataRefs,
          startedAt: trace.startedAt,
          completedAt: trace.completedAt,
          durationMs: trace.durationMs,
        }))
      )
    }

    // 3. Insert snapshot dependencies (append-only)
    if (result.dependencies.length > 0) {
      await t.insert(snapshotDependencies).values(
        result.dependencies.map((dep) => ({
          organizationId: result.organizationId,
          engineRunId: runId,
          dependencyType: dep.dependencyType,
          dependencyEntityId: dep.dependencyEntityId,
          dependencyEffectiveAt: dep.dependencyEffectiveAt,
          dependencyVersion: dep.dependencyVersion,
        }))
      )
    }

    // 4. Insert opportunity proposals (only for non-replay runs)
    if (!opts.isReplay && result.opportunityProposals.length > 0) {
      for (const proposal of result.opportunityProposals) {
        const [oppRow] = await t
          .insert(opportunities)
          .values({
            organizationId: result.organizationId,
            executionCaseId: result.executionCaseId,
            opportunityType: proposal.opportunityType as typeof opportunities.$inferInsert['opportunityType'],
            status: 'suggested',
            detectedAt: result.evaluatedAt,
            summary: proposal.summary,
            rationale: proposal.rationale,
            windowStartAt: proposal.windowStartAt,
            windowEndAt: proposal.windowEndAt,
            confidenceLevel: proposal.confidenceLevel as typeof opportunities.$inferInsert['confidenceLevel'],
            requiresReview: proposal.requiresLawyerReview,
            playbookVersionId: result.playbookVersionId,
          })
          .returning({ id: opportunities.id })

        // 5. Insert ExplanationBundle for this opportunity
        if (oppRow !== undefined) {
          await t.insert(explanationBundles).values({
            organizationId: result.organizationId,
            engineRunId: runId,
            targetEntityType: 'opportunity',
            targetEntityId: oppRow.id,
            conclusionType: 'opportunity',
            payload: proposal.explanationBundle,
            playbookVersionId: result.playbookVersionId,
            ruleIdsApplied: proposal.explanationBundle.legalRulesApplied.map((r) => r.ruleId),
          })
        }
      }
    }

    // 6. Mark run as completed
    await t
      .update(engineRuns)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(engineRuns.id, runId))

    return runId
  })
}

/**
 * Marks an EngineRun as failed (when evaluation throws before commit).
 */
export async function failEngineRun(
  db: AnyDbClient,
  runId: string,
  errorDetails: string
): Promise<void> {
  await db
    .update(engineRuns)
    .set({
      status: 'failed',
      errorDetails,
      completedAt: new Date(),
    })
    .where(eq(engineRuns.id, runId))
}
