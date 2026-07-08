/**
 * Client note routes — bloquinho de observações por cliente.
 * GET/POST /api/v1/clients/:clientId/notes
 * PATCH/DELETE /api/v1/clients/:clientId/notes/:noteId
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { toReadContext } from '../lib/read-context.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { serviceErrorToResponse, safeJsonBody } from '../lib/route-helpers.ts'
import { unprocessable } from '../lib/respond.ts'
import {
  listClientNotes,
  createClientNote,
  updateClientNote,
  deleteClientNote,
} from '../services/client-note.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const ParamsSchema = z.object({ clientId: z.string().uuid('Invalid client ID.') })
const NoteParamsSchema = ParamsSchema.extend({ noteId: z.string().uuid('Invalid note ID.') })
const NoteBodySchema = z.object({ body: z.string().min(1).max(5000) })

router.get('/:clientId/notes', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const parsed = ParamsSchema.safeParse({ clientId: c.req.param('clientId') })
  if (!parsed.success) return unprocessable(c, 'Invalid client ID.', { issues: parsed.error.issues })

  const ctx = toReadContext(buildWriteContext(c, db))
  const result = await listClientNotes(ctx, parsed.data.clientId)
  if (!result.success) return serviceErrorToResponse(c, result.error)
  return c.json({ data: result.data }, 200)
})

router.post('/:clientId/notes', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const parsedParams = ParamsSchema.safeParse({ clientId: c.req.param('clientId') })
  if (!parsedParams.success) return unprocessable(c, 'Invalid client ID.', { issues: parsedParams.error.issues })

  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Request body must be valid JSON.')
  const parsed = parseBody(NoteBodySchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const ctx = buildWriteContext(c, db)
  const result = await createClientNote(ctx, parsedParams.data.clientId, parsed.data.body)
  if (!result.success) return serviceErrorToResponse(c, result.error)
  return c.json({ data: result.data }, 201)
})

router.patch('/:clientId/notes/:noteId', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const parsedParams = NoteParamsSchema.safeParse({
    clientId: c.req.param('clientId'),
    noteId: c.req.param('noteId'),
  })
  if (!parsedParams.success) return unprocessable(c, 'Invalid parameters.', { issues: parsedParams.error.issues })

  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Request body must be valid JSON.')
  const parsed = parseBody(NoteBodySchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const ctx = buildWriteContext(c, db)
  const result = await updateClientNote(ctx, parsedParams.data.clientId, parsedParams.data.noteId, parsed.data.body)
  if (!result.success) return serviceErrorToResponse(c, result.error)
  return c.json({ data: result.data }, 200)
})

router.delete('/:clientId/notes/:noteId', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const parsedParams = NoteParamsSchema.safeParse({
    clientId: c.req.param('clientId'),
    noteId: c.req.param('noteId'),
  })
  if (!parsedParams.success) return unprocessable(c, 'Invalid parameters.', { issues: parsedParams.error.issues })

  const ctx = buildWriteContext(c, db)
  const result = await deleteClientNote(ctx, parsedParams.data.clientId, parsedParams.data.noteId)
  if (!result.success) return serviceErrorToResponse(c, result.error)
  return c.json({ data: { deleted: true } }, 200)
})

export { router as clientNotesRouter }
