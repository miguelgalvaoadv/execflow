/**
 * Case-scoped snapshot routes — propose lifecycle entries.
 *
 * POST /api/v1/cases/:caseId/sentence-snapshots
 * POST /api/v1/cases/:caseId/custody-snapshots
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
import { proposeSentenceSnapshot } from '../services/sentence-snapshot.ts'
import { proposeCustodySnapshot, CUSTODY_REGIMES } from '../services/custody-snapshot.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const MissingDataFlagSchema = z.object({
  field: z.string().min(1),
  impact: z.enum(['high', 'medium']),
  description: z.string().min(1),
})

const CrimeBreakdownItemSchema = z.object({
  crimeCode: z.string().min(1),
  crimeName: z.string().min(1),
  article: z.string().min(1),
  law: z.string().min(1),
  sentenceDays: z.number().int().min(1),
  isHediondo: z.boolean().default(false),
  isEquiparado: z.boolean().default(false),
  hasResultingDeath: z.boolean().default(false),
  isAttempted: z.boolean().default(false),
  sentenceDate: z.string().min(1),
  transitDate: z.string().min(1),
})

const ProposeSentenceSnapshotSchema = z.object({
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
  amendsSnapshotId: z.string().uuid().optional(),
  crimesBreakdown: z.array(CrimeBreakdownItemSchema).optional(),
  isGenericRecidivist: z.boolean().optional(),
})

const ProposeCustodySnapshotSchema = z.object({
  effectiveAt: z.string().min(1, 'effectiveAt is required'),
  regime: z.enum(CUSTODY_REGIMES),
  prisonUnitId: z.string().uuid().optional(),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
  sourceEventId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
  amendsSnapshotId: z.string().uuid().optional(),
})

router.post(
  '/:caseId/sentence-snapshots',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const caseId = c.req.param('caseId')
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(ProposeSentenceSnapshotSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await proposeSentenceSnapshot(ctx, caseId, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

router.post(
  '/:caseId/custody-snapshots',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const caseId = c.req.param('caseId')
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(ProposeCustodySnapshotSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await proposeCustodySnapshot(ctx, caseId, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

export { router as caseSnapshotsRouter }
