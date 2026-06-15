/**
 * Deadline routes
 *
 * GET    /api/v1/deadlines                    — Paginated org deadline list
 * GET    /api/v1/deadlines/:id/history         — Deadline change history
 * GET    /api/v1/deadlines/:id                 — Deadline detail
 * POST   /api/v1/deadlines                    — create deadline (assistant+)
 * POST   /api/v1/deadlines/:id/acknowledge    — acknowledge deadline (assistant+)
 * POST   /api/v1/deadlines/:id/complete        — complete deadline (assistant+)
 * POST   /api/v1/deadlines/:id/dismiss        — dismiss deadline (lawyer+)
 *
 * Route principles:
 * - Thin handlers: parse → validate → service → map result.
 * - No business logic in handlers; all state machine logic is in the service.
 * - Auth + org isolation enforced by middleware.
 * - RBAC enforced at route level; fine-grained checks (overdue-lawyer-only) in service.
 *
 * Architecture ref: execution-workflows.md §4, data-model-v1.md §2.8.
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
  createDeadline,
  acknowledgeDeadline,
  completeDeadline,
  dismissDeadline,
} from '../services/deadline.ts'
import {
  getDeadlineDetail,
  listDeadlineHistory,
  listDeadlinesForOrg,
} from '../services/deadline-read.ts'
import { toReadContext } from '../lib/read-context.ts'
import { PaginationQuerySchema } from '../lib/pagination-schemas.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const DeadlineIdParamSchema = z.object({
  id: z.string().uuid('Invalid deadline ID.'),
})

const ListDeadlinesQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['open', 'acknowledged', 'overdue', 'completed', 'dismissed']).optional(),
  deadlineClass: z
    .enum(['legal', 'benefit', 'disciplinary', 'calculation', 'internal', 'recurring', 'sla'])
    .optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  q: z.string().max(200).optional(),
})

// -------------------------------------------------------------------------
// GET /api/v1/deadlines — Paginated org deadline list
// -------------------------------------------------------------------------

router.get(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = ListDeadlinesQuerySchema.safeParse(c.req.query())
    if (!parsed.success) {
      return unprocessable(c, 'Invalid query parameters.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const q = parsed.data

    const result = await listDeadlinesForOrg(
      ctx,
      {
        ...(q.status !== undefined ? { status: q.status } : {}),
        ...(q.deadlineClass !== undefined ? { deadlineClass: q.deadlineClass } : {}),
        ...(q.priority !== undefined ? { priority: q.priority } : {}),
        ...(q.q !== undefined ? { q: q.q } : {}),
      },
      {
        limit: q.limit,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      }
    )

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data.items, nextCursor: result.data.nextCursor }, 200)
  }
)

// -------------------------------------------------------------------------
// GET /api/v1/deadlines/:id/history — Deadline change history
// -------------------------------------------------------------------------

router.get(
  '/:id/history',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = DeadlineIdParamSchema.safeParse({ id: c.req.param('id') })
    if (!parsed.success) {
      return unprocessable(c, 'Invalid deadline ID.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const result = await listDeadlineHistory(ctx, parsed.data.id)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

// -------------------------------------------------------------------------
// GET /api/v1/deadlines/:id — Deadline detail
// -------------------------------------------------------------------------

router.get(
  '/:id',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = DeadlineIdParamSchema.safeParse({ id: c.req.param('id') })
    if (!parsed.success) {
      return unprocessable(c, 'Invalid deadline ID.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const result = await getDeadlineDetail(ctx, parsed.data.id)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

// -------------------------------------------------------------------------
// Validation schemas
// -------------------------------------------------------------------------

const DEADLINE_CLASSES = [
  'legal', 'benefit', 'disciplinary', 'calculation', 'internal', 'recurring', 'sla',
] as const

const DEADLINE_ORIGINS = ['manual', 'extracted', 'rule', 'recurring'] as const

const DEADLINE_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const

const RecurrencePatternSchema = z.object({
  cadenceDays: z.number().int().positive().optional(),
  nextDueOffset: z.number().int().optional(),
  maxOccurrences: z.number().int().positive().optional(),
}).strict()

const CreateDeadlineSchema = z.object({
  executionCaseId: z.string().uuid('executionCaseId must be a valid UUID'),
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(5000).optional(),
  /** ISO 8601 datetime — the legal due date. */
  dueAt: z.string().datetime({ offset: true, message: 'dueAt must be a valid ISO 8601 datetime with timezone' }),
  deadlineClass: z.enum(DEADLINE_CLASSES),
  origin: z.enum(DEADLINE_ORIGINS),
  priority: z.enum(DEADLINE_PRIORITIES).optional(),
  assigneeUserId: z.string().uuid().optional(),
  sourceEventId: z.string().uuid().optional(),
  sourceDocumentId: z.string().uuid().optional(),
  playbookVersionId: z.string().uuid().optional(),
  legalBasis: z.string().max(1000).optional(),
  parentDeadlineId: z.string().uuid().optional(),
  recurrencePattern: RecurrencePatternSchema.optional(),
})

const CompleteDeadlineSchema = z.object({
  completionEvidenceType: z.enum([
    'document', 'filing', 'court_event', 'note', 'other', 'timeline_event', 'manual',
  ]).optional(),
  completionEvidenceId: z.string().uuid().optional(),
  reason: z.string().max(2000).optional(),
})

const DismissDeadlineSchema = z.object({
  dismissedReason: z.string().min(1, 'Dismissal reason is required').max(2000),
  dismissedReasonCode: z.enum([
    'completed_elsewhere',
    'superseded',
    'not_applicable',
    'court_extension',
    'client_withdrawal',
    'other',
  ]).optional(),
})

// -------------------------------------------------------------------------
// POST /api/v1/deadlines — Create a deadline
// -------------------------------------------------------------------------

router.post(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const body = await safeJsonBody(c)
    if (body === null) return unprocessable(c, 'Request body must be valid JSON.')

    const parsed = parseBody(CreateDeadlineSchema, body)
    if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

    const ctx = buildWriteContext(c, db)
    const result = await createDeadline(ctx, parsed.data)

    if (!result.success) return serviceErrorToResponse(c, result.error)
    return c.json({ data: result.data }, 201)
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/deadlines/:id/acknowledge
// -------------------------------------------------------------------------

router.post(
  '/:id/acknowledge',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const deadlineId = c.req.param('id')
    if (!deadlineId?.match(/^[0-9a-f-]{36}$/i)) {
      return unprocessable(c, 'Invalid deadline ID format.')
    }

    const ctx = buildWriteContext(c, db)
    const result = await acknowledgeDeadline(ctx, deadlineId)

    if (!result.success) return serviceErrorToResponse(c, result.error)
    return c.json({ data: result.data })
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/deadlines/:id/complete
// -------------------------------------------------------------------------

router.post(
  '/:id/complete',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const deadlineId = c.req.param('id')
    if (!deadlineId?.match(/^[0-9a-f-]{36}$/i)) {
      return unprocessable(c, 'Invalid deadline ID format.')
    }

    const body = await safeJsonBody(c)
    // Body is optional for completion (evidence is not strictly required yet)
    const input = body !== null ? parseBody(CompleteDeadlineSchema, body) : { success: true as const, data: {} }
    if (!input.success) return unprocessable(c, input.message, input.issues)

    const ctx = buildWriteContext(c, db)
    const result = await completeDeadline(ctx, deadlineId, input.data)

    if (!result.success) return serviceErrorToResponse(c, result.error)
    return c.json({ data: result.data })
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/deadlines/:id/dismiss
// -------------------------------------------------------------------------

/**
 * Dismiss a deadline. Lawyer-only.
 * The service additionally enforces that overdue dismissals require dismissedReasonCode.
 * RBAC enforced here at minimum level; the overdue-specific rule is in the service.
 */
router.post(
  '/:id/dismiss',
  authMiddleware,
  orgMiddleware,
  requireMinRole('lawyer'),
  async (c) => {
    const deadlineId = c.req.param('id')
    if (!deadlineId?.match(/^[0-9a-f-]{36}$/i)) {
      return unprocessable(c, 'Invalid deadline ID format.')
    }

    const body = await safeJsonBody(c)
    if (body === null) return unprocessable(c, 'Request body must be valid JSON.')

    const parsed = parseBody(DismissDeadlineSchema, body)
    if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

    const ctx = buildWriteContext(c, db)
    const result = await dismissDeadline(ctx, deadlineId, parsed.data)

    if (!result.success) return serviceErrorToResponse(c, result.error)
    return c.json({ data: result.data })
  }
)

export { router as deadlinesRouter }
