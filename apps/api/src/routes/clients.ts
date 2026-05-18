/**
 * Client routes — POST /api/v1/clients
 *
 * Route principles:
 * - Thin handler: parse body → validate → call service → map result.
 * - No business logic in route handlers.
 * - All auth + org isolation enforced by middleware.
 * - Typed request validation via Zod.
 *
 * Architecture ref: ARCHITECTURE_RULES.md §F-05, §M-01.
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
import { createClient } from '../services/client.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// POST /api/v1/clients — Create a new client
// -------------------------------------------------------------------------

/**
 * Zod schema for client creation request body.
 * Mirrors CreateClientInput in services/client.ts.
 */
const CreateClientSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(300),
  cpf: z.string().optional(),
  rg: z.string().max(30).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be in YYYY-MM-DD format')
    .optional(),
  displayName: z.string().max(300).optional(),
  aliases: z.array(z.string().max(300)).max(20).optional(),
  internalRef: z.string().max(100).optional(),
  responsibleLawyerUserId: z.string().uuid().optional(),
  contactChannels: z
    .array(
      z.object({
        type: z.string().max(50),
        value: z.string().max(200),
        notes: z.string().max(500).optional(),
      })
    )
    .max(10)
    .optional(),
  notes: z.string().max(5000).optional(),
})

router.post(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'), // assistants and above may register clients
  async (c) => {
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(CreateClientSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await createClient(ctx, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    // 201 Created: return the new client resource
    return c.json({ data: result.data }, 201)
  }
)

export { router as clientsRouter }
