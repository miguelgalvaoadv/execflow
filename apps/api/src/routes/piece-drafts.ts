import { Hono } from 'hono'
import type { HonoVariables } from '../context/types.ts'
import type { HonoContext } from '../context/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { ClaudeDrafterService, FreshnessGateError } from '../services/claude-drafter.ts'
import { markdownToDocx } from '../services/docx-exporter.ts'
import { db } from '../lib/db.ts'
import { pieceDrafts } from '@execflow/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { parseBody } from '../lib/zod-helpers.ts'

export const pieceDraftsRouter = new Hono<{ Variables: HonoVariables }>()

// Piso de role: minutas são trabalho jurídico interno — nunca 'client'.
pieceDraftsRouter.use('*', authMiddleware, orgMiddleware, requireMinRole('assistant'))

const drafterService = new ClaudeDrafterService()

/**
 * GET /api/v1/piece-drafts/by-case/:caseId
 * Lista as peças geradas pelo Claude para um caso (mais recentes primeiro).
 * Usado para exibi-las junto dos documentos do caso.
 */
pieceDraftsRouter.get('/by-case/:caseId', async (c) => {
  const caseId = c.req.param('caseId')
  const { organization } = c.get('org')
  const rows = await db
    .select({
      id: pieceDrafts.id,
      status: pieceDrafts.status,
      modelUsed: pieceDrafts.modelUsed,
      createdAt: pieceDrafts.createdAt,
      updatedAt: pieceDrafts.updatedAt,
      finalizedAt: pieceDrafts.finalizedAt,
      opportunityId: pieceDrafts.opportunityId,
    })
    .from(pieceDrafts)
    .where(and(eq(pieceDrafts.executionCaseId, caseId), eq(pieceDrafts.organizationId, organization.id)))
    .orderBy(desc(pieceDrafts.createdAt))
  return c.json({ data: rows })
})

/**
 * POST /api/v1/piece-drafts/generate/:opportunityId
 * Triggers Claude to generate a petition for the given opportunity.
 */
pieceDraftsRouter.post(
  '/generate/:opportunityId',
  async (c) => {
    const oppId = c.req.param('opportunityId')
    const body = await c.req.json().catch(() => ({}))
    const { instructions, systemPrompt, userPrompt } = z
      .object({
        instructions: z.string().optional(),
        systemPrompt: z.string().optional(),
        userPrompt: z.string().optional(),
      })
      .parse(body)

    try {
      const options: { instructions?: string; systemPrompt?: string; userPrompt?: string } = {}
      if (instructions !== undefined) options.instructions = instructions
      if (systemPrompt !== undefined) options.systemPrompt = systemPrompt
      if (userPrompt !== undefined) options.userPrompt = userPrompt
      const draft = await drafterService.generateDraftForOpportunity(c, oppId, options)
      return c.json(draft, 201)
    } catch (err: any) {
      if (err instanceof FreshnessGateError) {
        return c.json(
          {
            error: 'FRESHNESS_GATE_BLOCKED',
            message: err.message,
            pendingCriticalMovementType: err.pendingCriticalMovementType,
            pendingCriticalMovementSince: err.pendingCriticalMovementSince,
          },
          409
        )
      }
      return c.json({ error: err.message }, 400)
    }
  }
)

/**
 * GET /api/v1/piece-drafts/preview-prompt/:opportunityId
 * Retorna o prompt padrão (system + user) que SERIA enviado ao Claude, para a
 * tela exibir e o advogado editar antes de gerar a peça.
 */
pieceDraftsRouter.get(
  '/preview-prompt/:opportunityId',
  async (c) => {
    const oppId = c.req.param('opportunityId')
    try {
      const prompts = await drafterService.previewPrompt(c, oppId)
      return c.json({ data: prompts }, 200)
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

      if (!draft || !draft.contentMarkdown) {
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
