import { Hono } from 'hono'
import type { HonoVariables } from '../context/types.ts'
import type { HonoContext } from '../context/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { ClaudeDrafterService } from '../services/claude-drafter.ts'
import { markdownToDocx } from '../services/docx-exporter.ts'
import { z } from 'zod'
import { parseBody } from '../lib/zod-helpers.ts'

export const pieceDraftsRouter = new Hono<{ Variables: HonoVariables }>()

pieceDraftsRouter.use('*', authMiddleware, orgMiddleware)

const drafterService = new ClaudeDrafterService()

/**
 * POST /api/v1/piece-drafts/generate/:opportunityId
 * Triggers Claude to generate a petition for the given opportunity.
 */
pieceDraftsRouter.post(
  '/generate/:opportunityId',
  async (c) => {
    const oppId = c.req.param('opportunityId')
    const body = await c.req.json().catch(() => ({}))
    const { instructions } = z.object({ instructions: z.string().optional() }).parse(body)
    
    try {
      const draft = await drafterService.generateDraftForOpportunity(c, oppId, instructions)
      return c.json(draft, 201)
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  }
)

/**
 * GET /api/v1/piece-drafts/:draftId
 * Retrieves an existing draft.
 */
pieceDraftsRouter.get(
  '/:draftId',
  async (c) => {
    const draftId = c.req.param('draftId')
    try {
      const draft = await drafterService.getDraft(c, draftId)
      return c.json(draft, 200)
    } catch (err: any) {
      return c.json({ error: err.message }, 404)
    }
  }
)

/**
 * PUT /api/v1/piece-drafts/:draftId
 * Updates the draft's markdown content, optionally finalizing it.
 */
pieceDraftsRouter.put(
  '/:draftId',
  async (c) => {
    const draftId = c.req.param('draftId')
    const body = await c.req.json()
    const { contentMarkdown, finalize } = z
      .object({
        contentMarkdown: z.string(),
        finalize: z.boolean().optional(),
      })
      .parse(body)
    try {
      const updated = await drafterService.updateDraft(c, draftId, contentMarkdown, finalize)
      return c.json(updated, 200)
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  }
)

/**
 * GET /api/v1/piece-drafts/:draftId/export-docx
 * Exporta a peça processual como um arquivo Word (.docx) editável.
 */
pieceDraftsRouter.get(
  '/:draftId/export-docx',
  async (c) => {
    const draftId = c.req.param('draftId')
    try {
      const draft = await drafterService.getDraft(c, draftId)

      if (!draft.contentMarkdown) {
        return c.json({ error: 'Rascunho sem conteúdo para exportar.' }, 400)
      }

      const docxBuffer = await markdownToDocx(draft.contentMarkdown, {
        title: `Peça Processual — ExecFlow`,
      })

      const fileName = `peca_${draftId.substring(0, 8)}_${new Date().toISOString().split('T')[0]}.docx`

      c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      c.header('Content-Disposition', `attachment; filename="${fileName}"`)
      c.header('Content-Length', String(docxBuffer.length))

      return c.body(docxBuffer as any)
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  }
)
