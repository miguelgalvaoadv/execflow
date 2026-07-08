/**
 * Case note routes — bloquinho de observações por processo (execução).
 * GET/POST /api/v1/cases/:caseId/notes
 * PATCH/DELETE /api/v1/cases/:caseId/notes/:noteId
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
  listCaseNotes,
  createCaseNote,
  updateCaseNote,
  deleteCaseNote,
} from '../services/case-note.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const ParamsSchema = z.object({ caseId: z.string().uuid('Invalid case ID.') })
const NoteParamsSchema = ParamsSchema.extend({ noteId: z.string().uuid('Invalid note ID.') })
const NoteBodySchema = z.object({ body: z.string().min(1).max(5000) })

router.get('/:caseId/notes', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const parsed = ParamsSchema.safeParse({ caseId: c.req.param('caseId') })
  if (!parsed.success) return unprocessable(c, 'Invalid case ID.', { issues: parsed.error.issues })

  const ctx = toReadContext(buildWriteContext(c, db))
  const result = await listCaseNotes(ctx, parsed.data.caseId)
  if (!result.success) return serviceErrorToResponse(c, result.error)
  return c.json({ data: result.data }, 200)
})

router.post('/:caseId/notes', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const parsedParams = ParamsSchema.safeParse({ caseId: c.req.param('caseId') })
  if (!parsedParams.success) return unprocessable(c, 'Invalid case ID.', { issues: parsedParams.error.issues })

  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Request body must be valid JSON.')
  const parsed = parseBody(NoteBodySchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const ctx = buildWriteContext(c, db)
  const result = await createCaseNote(ctx, parsedParams.data.caseId, parsed.data.body)
  if (!result.success) return serviceErrorToResponse(c, result.error)
  return c.json({ data: result.data }, 201)
})

router.patch('/:caseId/notes/:noteId', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const parsedParams = NoteParamsSchema.safeParse({
    caseId: c.req.param('caseId'),
    noteId: c.req.param('noteId'),
  })
  if (!parsedParams.success) return unprocessable(c, 'Invalid parameters.', { issues: parsedParams.error.issues })

  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Request body must be valid JSON.')
  const parsed = parseBody(NoteBodySchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const ctx = buildWriteContext(c, db)
  const result = await updateCaseNote(ctx, parsedParams.data.caseId, parsedParams.data.noteId, parsed.data.body)
  if (!result.success) return serviceErrorToResponse(c, result.error)
  return c.json({ data: result.data }, 200)
})

router.delete('/:caseId/notes/:noteId', authMiddleware, orgMiddleware, requireMinRole('assistant'), async (c) => {
  const parsedParams = NoteParamsSchema.safeParse({
    caseId: c.req.param('caseId'),
    noteId: c.req.param('noteId'),
  })
  if (!parsedParams.success) return unprocessable(c, 'Invalid parameters.', { issues: parsedParams.error.issues })

  const ctx = buildWriteContext(c, db)
  const result = await deleteCaseNote(ctx, parsedParams.data.caseId, parsedParams.data.noteId)
  if (!result.success) return serviceErrorToResponse(c, result.error)
  return c.json({ data: { deleted: true } }, 200)
})

export { router as caseNotesRouter }
