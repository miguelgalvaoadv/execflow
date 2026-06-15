/**
 * Sentence snapshot lifecycle routes (by snapshot id).
 *
 * POST /api/v1/sentence-snapshots/:id/confirm
 * POST /api/v1/sentence-snapshots/:id/supersede
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
  confirmSentenceSnapshot,
  supersedeSentenceSnapshot,
} from '../services/sentence-snapshot.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const MissingDataFlagSchema = z.object({
  field: z.string().min(1),
  impact: z.enum(['high', 'medium']),
  description: z.string().min(1),
})

const SupersedeSentenceSnapshotSchema = z.object({
  reason: z.string().min(1, 'reason is required').max(2000),
  effectiveAt: z.string().min(1, 'effectiveAt is required'),
  totalSentenceDays: z.number().int().min(1),
  servedDays: z.number().int().min(0).optional(),
  remissionDays: z.number().int().min(0).optional(),
  detractionDays: z.number().int().min(0).optional(),
  confidenceLevel: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
  calculationMethod: z.string().max(2000).optional(),
  playbookVersionId: z.string().uuid().optional(),
  sourceDocumentIds: z.array(z.string().uuid()).optional(),
  explanation: z.record(z.string(), z.unknown()).optional(),
  missingDataFlags: z.array(MissingDataFlagSchema).optional(),
})

router.post(
  '/:id/confirm',
  authMiddleware,
  orgMiddleware,
  requireLawyer,
  async (c) => {
    const snapshotId = c.req.param('id')
    const ctx = buildWriteContext(c, db)
    const result = await confirmSentenceSnapshot(ctx, snapshotId)

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

    const parsed = parseBody(SupersedeSentenceSnapshotSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await supersedeSentenceSnapshot(ctx, snapshotId, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

export { router as sentenceSnapshotsRouter }
