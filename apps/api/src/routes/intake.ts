/**
 * Intake routes — POST /api/v1/intake
 *
 * Intake is the entry point for all new information (documents, case data).
 * Bundles are created first; documents are linked via the documents route.
 *
 * Authorization: assistant+ (assistants manage intake processing).
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
import { registerIntakeBundle } from '../services/intake.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// POST /api/v1/intake — Register a new intake bundle
// -------------------------------------------------------------------------

const RegisterIntakeBundleSchema = z.object({
  sourceChannel: z.enum([
    'intake_manual',
    'intake_pdf',
    'intake_scan',
    'intake_whatsapp',
    'intake_email',
    'intake_api',
    'intake_tribunal',
  ]),

  /**
   * Operational receipt timestamp (ISO 8601).
   * May differ from the request timestamp for async/delayed intake.
   */
  receivedAt: z.string().optional(),

  /** AI/system suggested client UUID (NOT human-confirmed). */
  proposedClientId: z.string().uuid().optional(),

  /** AI/system suggested case UUID (NOT human-confirmed). */
  proposedExecutionCaseId: z.string().uuid().optional(),

  /**
   * Missing data fields at intake creation time.
   * Drives the recovery workflow.
   */
  missingFields: z
    .array(
      z.object({
        field: z.string().max(100),
        reason: z.string().max(500),
        required: z.boolean(),
      })
    )
    .max(50)
    .optional(),

  notes: z.string().max(2000).optional(),
})

router.post(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(RegisterIntakeBundleSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await registerIntakeBundle(ctx, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

export { router as intakeRouter }
