/**
 * Extraction review routes.
 *
 * POST /api/v1/extractions/:id/confirm  — assistant+
 * POST /api/v1/extractions/:id/reject   — assistant+
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
  confirmExtractionReview,
  rejectExtractionReview,
} from '../services/extraction-review.ts'
import { promoteExtractionToSnapshot } from '../services/extraction-promotion.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const ConfirmExtractionSchema = z.object({
  reason: z.string().min(1).max(5000).optional(),
})

const RejectExtractionSchema = z.object({
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters.').max(5000),
})

router.post(
  '/:id/confirm',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const extractionRunId = c.req.param('id')
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(ConfirmExtractionSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await confirmExtractionReview(ctx, extractionRunId, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

router.post(
  '/:id/reject',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const extractionRunId = c.req.param('id')
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(RejectExtractionSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await rejectExtractionReview(ctx, extractionRunId, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

const PromoteSnapshotSchema = z.object({
  executionCaseId: z.string().uuid('executionCaseId must be a valid UUID.'),
  effectiveAt: z.string().min(1, 'effectiveAt is required. Use ISO 8601 format.'),
  fieldOverrides: z
    .array(
      z.object({
        fieldPath: z.string().min(1),
        correctedValue: z.unknown(),
      })
    )
    .optional(),
  reason: z.string().min(1).max(5000).optional(),
})

router.post(
  '/:id/promote-snapshot',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const extractionRunId = c.req.param('id')
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(PromoteSnapshotSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await promoteExtractionToSnapshot(ctx, extractionRunId, {
      executionCaseId: parsed.data.executionCaseId,
      effectiveAt: parsed.data.effectiveAt,
      ...(parsed.data.fieldOverrides ? { fieldOverrides: parsed.data.fieldOverrides } : {}),
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    })

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

export { router as extractionsRouter }
