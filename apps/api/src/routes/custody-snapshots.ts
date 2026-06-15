/**
 * Custody snapshot lifecycle routes (by snapshot id).
 *
 * POST /api/v1/custody-snapshots/:id/confirm
 * POST /api/v1/custody-snapshots/:id/supersede
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireLawyer } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { serviceErrorToResponse, safeJsonBody } from '../lib/route-helpers.ts'
import {
  confirmCustodySnapshot,
  supersedeCustodySnapshot,
  CUSTODY_REGIMES,
} from '../services/custody-snapshot.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const SupersedeCustodySnapshotSchema = z.object({
  reason: z.string().min(1, 'reason is required').max(2000),
  effectiveAt: z.string().min(1, 'effectiveAt is required'),
  regime: z.enum(CUSTODY_REGIMES),
  prisonUnitId: z.string().uuid().optional(),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
  sourceEventId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
})

router.post(
  '/:id/confirm',
  authMiddleware,
  orgMiddleware,
  requireLawyer,
  async (c) => {
    const snapshotId = c.req.param('id')
    const ctx = buildWriteContext(c, db)
    const result = await confirmCustodySnapshot(ctx, snapshotId)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

router.post(
  '/:id/supersede',
  authMiddleware,
  orgMiddleware,
  requireLawyer,
  async (c) => {
    const snapshotId = c.req.param('id')
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(SupersedeCustodySnapshotSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await supersedeCustodySnapshot(ctx, snapshotId, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

export { router as custodySnapshotsRouter }
