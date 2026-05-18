/**
 * ExecutionCase routes — POST /api/v1/cases
 *
 * Opening a case is a high-consequence action that:
 * - Creates the case with legal temporal metadata
 * - Appends an opening timeline event
 * - Emits a domain event for downstream consumption
 *
 * Authorization: lawyer or admin only (not assistant — case creation is legal work).
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
import { createCase } from '../services/case.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// POST /api/v1/cases — Create a new execution case
// -------------------------------------------------------------------------

const CreateCaseSchema = z.object({
  clientId: z.string().uuid('clientId must be a valid UUID'),
  internalRef: z.string().min(1, 'Internal reference is required').max(100),

  /**
   * Legal/operational open date (ISO 8601).
   * TWO-CLOCK: this is the LEGAL date, not the current system timestamp.
   * May be in the past.
   */
  openedAt: z.string().min(1, 'openedAt (legal open date) is required'),

  executionProcessNumber: z.string().max(100).optional(),
  originProcessNumber: z.string().max(100).optional(),
  courtName: z.string().max(300).optional(),
  courtJurisdiction: z.string().max(200).optional(),
  caseKind: z.enum(['primary', 'apenso', 'incident', 'parallel']).optional(),
  parentExecutionCaseId: z.string().uuid().optional(),
  responsibleLawyerUserId: z.string().uuid().optional(),
  sentenceSummary: z.string().max(2000).optional(),
})

router.post(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('lawyer'), // case creation is legal work — lawyer+ only
  async (c) => {
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(CreateCaseSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await createCase(ctx, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

export { router as casesRouter }
