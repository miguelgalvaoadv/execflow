/**
 * Engine routes — legal computation engine API.
 *
 * GET  /api/v1/engine/runs/:runId            — fetch a single engine run
 * GET  /api/v1/engine/runs?caseId=           — list engine runs for a case
 * POST /api/v1/engine/evaluate               — trigger evaluation for a case
 * POST /api/v1/engine/recalculate            — trigger recalculation for a case
 * GET  /api/v1/engine/runs/:runId/explanation— get the ExplanationBundle for a run
 * GET  /api/v1/engine/replay                 — point-in-time historical replay
 *
 * DESIGN PRINCIPLES:
 * - Engine outputs are non-binding candidates (execution-engine.md §6).
 * - evaluate/recalculate run synchronously for small cases (async for large).
 * - All engine outputs include provenance (playbookVersionId, ruleIds).
 * - Replay is read-only — no new Opportunities created.
 *
 * HUMAN AUTHORITY BOUNDARY:
 * The engine SUGGESTS. Lawyers QUALIFY. This API never returns
 * "client is eligible" as a binding statement.
 *
 * Architecture ref: execution-engine.md §6 (human authority boundaries).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { safeJsonBody } from '../lib/route-helpers.ts'
import { unprocessable, notFound } from '../lib/respond.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { eq, and, desc } from '@execflow/db/client'
import { engineRuns, engineRuleTraces, explanationBundles } from '@execflow/db/schema'
import { assertEngineRunRowIsReplayBoolean } from '@execflow/db/types'
import { runEvaluation, commitEngineRun, failEngineRun, replayAtPointInTime } from '@execflow/engine'
import { randomUUID } from 'crypto'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const UUID_RE = /^[0-9a-f-]{36}$/i

// ---------------------------------------------------------------------------
// GET /api/v1/engine/runs/:runId — fetch a single engine run
// ---------------------------------------------------------------------------

router.get('/runs/:runId', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const ctx = buildWriteContext(c, db)
  const runId = c.req.param('runId')
  if (runId === undefined || !UUID_RE.test(runId)) {
    return unprocessable(c, 'Invalid engine run ID format.')
  }

  const [run] = await db
    .select()
    .from(engineRuns)
    .where(
      and(
        eq(engineRuns.id, runId),
        eq(engineRuns.organizationId, ctx.organizationId)
      )
    )
    .limit(1)

  if (run === undefined) {
    return notFound(c, 'EngineRun')
  }

  assertEngineRunRowIsReplayBoolean(run, `GET /engine/runs/${runId}`)

  return c.json({ data: run })
})

// ---------------------------------------------------------------------------
// GET /api/v1/engine/runs?caseId= — list engine runs for a case
// ---------------------------------------------------------------------------

router.get('/runs', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const ctx = buildWriteContext(c, db)
  const caseId = c.req.query('caseId')
  const limitStr = c.req.query('limit') ?? '20'
  const limit = Math.min(parseInt(limitStr, 10) || 20, 100)

  const conditions = [eq(engineRuns.organizationId, ctx.organizationId)]
  if (caseId !== undefined) {
    conditions.push(eq(engineRuns.executionCaseId, caseId))
  }

  const runs = await db
    .select()
    .from(engineRuns)
    .where(and(...conditions))
    .orderBy(desc(engineRuns.evaluatedAt))
    .limit(limit)

  for (const run of runs) {
    assertEngineRunRowIsReplayBoolean(run, 'GET /engine/runs')
  }

  return c.json({ data: runs, count: runs.length })
})

// ---------------------------------------------------------------------------
// GET /api/v1/engine/runs/:runId/explanation — ExplanationBundle for a run
// ---------------------------------------------------------------------------

router.get('/runs/:runId/explanation', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const ctx = buildWriteContext(c, db)
  const runId = c.req.param('runId')
  if (runId === undefined || !UUID_RE.test(runId)) {
    return unprocessable(c, 'Invalid engine run ID format.')
  }

  // Verify run belongs to org
  const [run] = await db
    .select({ id: engineRuns.id })
    .from(engineRuns)
    .where(
      and(
        eq(engineRuns.id, runId),
        eq(engineRuns.organizationId, ctx.organizationId)
      )
    )
    .limit(1)

  if (run === undefined) return notFound(c, 'EngineRun')

  const bundles = await db
    .select()
    .from(explanationBundles)
    .where(eq(explanationBundles.engineRunId, runId))
    .orderBy(explanationBundles.createdAt)

  const traces = await db
    .select()
    .from(engineRuleTraces)
    .where(eq(engineRuleTraces.engineRunId, runId))
    .orderBy(engineRuleTraces.evaluationOrder)

  return c.json({ data: { bundles, traces } })
})

// ---------------------------------------------------------------------------
// POST /api/v1/engine/evaluate — trigger evaluation for a case
// ---------------------------------------------------------------------------

const EvaluateBodySchema = z.object({
  caseId: z.string().uuid(),
  jurisdictionScope: z.string().default('BR-FED'),
})

router.post('/evaluate', authMiddleware, orgMiddleware, requireMinRole('lawyer'), async (c) => {
  const reqCtx = buildWriteContext(c, db)
  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Request body must be valid JSON.')

  const parsed = parseBody(EvaluateBodySchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const { caseId, jurisdictionScope } = parsed.data
  const runId = randomUUID()

  try {
    const { result, ctx: evalCtx } = await runEvaluation(db, {
      runId,
      organizationId: reqCtx.organizationId,
      executionCaseId: caseId,
      evaluatedAt: new Date(),
      jurisdictionScope,
      trigger: 'manual',
    })

    const committedRunId = await commitEngineRun(db, evalCtx, result, {
      trigger: 'manual',
      requestedByUserId: reqCtx.userId,
      isReplay: false,
      propagation: {
        correlationId: reqCtx.correlationId,
        requestId: reqCtx.requestId,
      },
    })

    return c.json({
      data: {
        engineRunId: committedRunId,
        opportunitiesCreated: result.opportunityProposals.length,
        overallConfidence: result.overallConfidence,
        overallUncertaintyLevel: result.overallUncertaintyLevel,
        globalBlockingCodes: result.globalBlockingCodes,
        warnings: result.warnings,
      },
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await failEngineRun(db, runId, errorMsg)
    return c.json(
      { error: { code: 'ENGINE_ERROR', message: errorMsg } },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// POST /api/v1/engine/recalculate — trigger recalculation for a case
// ---------------------------------------------------------------------------

const RecalculateBodySchema = z.object({
  caseId: z.string().uuid(),
  reason: z.string().min(1),
  jurisdictionScope: z.string().default('BR-FED'),
})

router.post('/recalculate', authMiddleware, orgMiddleware, requireMinRole('lawyer'), async (c) => {
  const reqCtx = buildWriteContext(c, db)
  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Request body must be valid JSON.')

  const parsed = parseBody(RecalculateBodySchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const { caseId, reason, jurisdictionScope } = parsed.data
  const runId = randomUUID()

  try {
    const { result, ctx: evalCtx } = await runEvaluation(db, {
      runId,
      organizationId: reqCtx.organizationId,
      executionCaseId: caseId,
      evaluatedAt: new Date(),
      jurisdictionScope,
      trigger: 'recalculation',
    })

    const committedRunId = await commitEngineRun(db, evalCtx, result, {
      trigger: 'recalculation',
      requestedByUserId: reqCtx.userId,
      isReplay: false,
      propagation: {
        correlationId: reqCtx.correlationId,
        requestId: reqCtx.requestId,
      },
    })

    return c.json({
      data: {
        engineRunId: committedRunId,
        reason,
        opportunitiesCreated: result.opportunityProposals.length,
        overallConfidence: result.overallConfidence,
        globalBlockingCodes: result.globalBlockingCodes,
      },
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await failEngineRun(db, runId, errorMsg)
    return c.json(
      { error: { code: 'ENGINE_ERROR', message: errorMsg } },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// GET /api/v1/engine/replay?caseId=&asOf= — point-in-time replay
// ---------------------------------------------------------------------------

router.get('/replay', authMiddleware, orgMiddleware, requireMinRole('lawyer'), async (c) => {
  const ctx = buildWriteContext(c, db)
  const caseId = c.req.query('caseId')
  const asOfStr = c.req.query('asOf')

  if (caseId === undefined) {
    return unprocessable(c, 'caseId is required')
  }
  if (asOfStr === undefined) {
    return unprocessable(c, 'asOf date is required (ISO 8601)')
  }

  const asOfDate = new Date(asOfStr)
  if (isNaN(asOfDate.getTime())) {
    return unprocessable(c, 'asOf must be a valid ISO 8601 date')
  }

  try {
    const replayBundle = await replayAtPointInTime(db, {
      organizationId: ctx.organizationId,
      executionCaseId: caseId,
      asOfDate,
      useHistoricalPlaybook: true,
    })

    return c.json({
      data: {
        asOfDate: replayBundle.asOfDate,
        playbookVersionId: replayBundle.playbookVersionId,
        isConsistentWithCurrent: replayBundle.consistentWithCurrent,
        overallConfidence: replayBundle.runResult.overallConfidence,
        globalBlockingCodes: replayBundle.runResult.globalBlockingCodes,
        opportunityProposals: replayBundle.runResult.opportunityProposals.map((p) => ({
          opportunityType: p.opportunityType,
          summary: p.summary,
          confidence: p.confidenceLevel,
          riskLevel: p.riskLevel,
        })),
        warnings: replayBundle.runResult.warnings,
        disclaimer: 'SIMULAÇÃO HISTÓRICA — NÃO VINCULANTE. Resultados baseados em dados disponíveis na data indicada.',
      },
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return c.json(
      { error: { code: 'REPLAY_ERROR', message: errorMsg } },
      500
    )
  }
})

export { router as engineRouter }
