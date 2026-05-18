/**
 * Queue and workflow task routes.
 *
 * GET  /api/v1/queue-projections              — list active queue items (org-scoped)
 * POST /api/v1/workflow-tasks/:id/claim       — claim a workflow task
 * POST /api/v1/workflow-tasks/:id/release     — release a workflow task
 * POST /api/v1/workflow-tasks/:id/complete    — complete a workflow task
 *
 * DESIGN:
 * - Queue projections are READ-ONLY from the API. All writes go through workers.
 * - Workflow tasks support claim/release/complete operations from the API.
 * - All operations are org-scoped via auth + org middleware.
 *
 * VALIDATION:
 * - Double-claim: service rejects if task already claimed (409)
 * - Stale ownership: service rejects release if not current claimant (403)
 * - Terminal-task: service rejects complete if already terminal (409)
 *
 * Architecture ref: office-operating-system.md §3, §4.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { serviceErrorToResponse, safeJsonBody } from '../lib/route-helpers.ts'
import { unprocessable } from '../lib/respond.ts'
import {
  listQueueProjections,
} from '../repositories/queue-projection.ts'
import {
  claimTask,
  releaseTask,
  completeTask,
} from '../services/workflow-task.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// Validation schemas
// -------------------------------------------------------------------------

const QUEUE_TYPES = [
  'intake_review', 'extraction_review', 'missing_data', 'progression_opportunities',
  'pad_defense', 'overdue_deadlines', 'pending_filings', 'recalculation_conflicts',
  'ai_review', 'urgent_liberty_risks', 'opportunity_review', 'workflow_tasks',
] as const

const ListQueueProjectionsQuerySchema = z.object({
  queueType: z.enum(QUEUE_TYPES).optional(),
  assigneeUserId: z.string().uuid().optional(),
  executionCaseId: z.string().uuid().optional(),
  priority: z.coerce.number().int().min(0).max(3).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})

const CompleteTaskSchema = z.object({
  evidenceType: z.enum([
    'timeline_event', 'document', 'filing', 'manual',
  ]).optional(),
  evidenceId: z.string().optional(),
})

// -------------------------------------------------------------------------
// GET /api/v1/queue-projections — list active queue items
// -------------------------------------------------------------------------

router.get(
  '/',
  authMiddleware,
  orgMiddleware,
  async (c) => {
    const rawQuery = c.req.query()
    const parsed = ListQueueProjectionsQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      return unprocessable(c, 'Invalid query parameters', {
        issues: parsed.error.issues,
      })
    }

    const ctx = buildWriteContext(c, db)
    const q = parsed.data

    const result = await listQueueProjections(
      ctx.db,
      ctx.organizationId,
      {
        ...(q.queueType !== undefined ? { queueType: q.queueType } : {}),
        ...(q.assigneeUserId !== undefined ? { assigneeUserId: q.assigneeUserId } : {}),
        ...(q.executionCaseId !== undefined ? { executionCaseId: q.executionCaseId } : {}),
        ...(q.priority !== undefined ? { priority: q.priority } : {}),
        excludeResolved: true,
      },
      {
        limit: q.limit,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      }
    )

    if (!result.success) {
      return serviceErrorToResponse(c, { code: 'INTERNAL', message: 'Failed to list queue projections.' })
    }

    return c.json({
      data: result.data.items,
      nextCursor: result.data.nextCursor,
    })
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/workflow-tasks/:id/claim — claim a task
// -------------------------------------------------------------------------

router.post(
  '/workflow-tasks/:id/claim',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const taskId = c.req.param('id')
    const ctx = buildWriteContext(c, db)

    const result = await claimTask(ctx, taskId)
    if (!result.success) return serviceErrorToResponse(c, result.error)

    return c.json({ data: result.data }, 200)
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/workflow-tasks/:id/release — release a task
// -------------------------------------------------------------------------

router.post(
  '/workflow-tasks/:id/release',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const taskId = c.req.param('id')
    const ctx = buildWriteContext(c, db)

    const result = await releaseTask(ctx, taskId)
    if (!result.success) return serviceErrorToResponse(c, result.error)

    return c.json({ data: result.data }, 200)
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/workflow-tasks/:id/complete — complete a task
// -------------------------------------------------------------------------

router.post(
  '/workflow-tasks/:id/complete',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const taskId = c.req.param('id')

    const body = await safeJsonBody(c)
    const parsed = parseBody(CompleteTaskSchema, body ?? {})
    if (!parsed.success) {
      return unprocessable(c, parsed.message)
    }

    const ctx = buildWriteContext(c, db)
    const result = await completeTask(ctx, taskId, {
      ...(parsed.data.evidenceType !== undefined ? { evidenceType: parsed.data.evidenceType } : {}),
      ...(parsed.data.evidenceId !== undefined ? { evidenceId: parsed.data.evidenceId } : {}),
    })

    if (!result.success) return serviceErrorToResponse(c, result.error)

    return c.json({ data: result.data }, 200)
  }
)

export { router as queueRouter }
