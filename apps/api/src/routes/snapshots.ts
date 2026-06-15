/**
 * Unified snapshot review routes.
 *
 * GET  /api/v1/snapshots/:id
 * POST /api/v1/snapshots/:id/confirm — lawyer+
 * POST /api/v1/snapshots/:id/reject  — lawyer+
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireLawyer, requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { serviceErrorToResponse, safeJsonBody } from '../lib/route-helpers.ts'
import { unprocessable } from '../lib/respond.ts'
import {
  getSnapshotReview,
  confirmSnapshotReview,
  rejectSnapshotReview,
} from '../services/snapshot-review.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const ConfirmSnapshotSchema = z.object({
  reason: z.string().min(1).max(5000).optional(),
})

const RejectSnapshotSchema = z.object({
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters.').max(5000),
})

router.get(
  '/:id',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const snapshotId = c.req.param('id')
    const ctx = buildWriteContext(c, db)
    const result = await getSnapshotReview(ctx, snapshotId)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

router.post(
  '/:id/confirm',
  authMiddleware,
  orgMiddleware,
  requireLawyer,
  async (c) => {
    const snapshotId = c.req.param('id')
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(ConfirmSnapshotSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await confirmSnapshotReview(ctx, snapshotId, parsed.data)

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
  requireLawyer,
  async (c) => {
    const snapshotId = c.req.param('id')
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(RejectSnapshotSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await rejectSnapshotReview(ctx, snapshotId, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

export { router as snapshotsRouter }
