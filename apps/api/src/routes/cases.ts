/**
 * ExecutionCase routes — GET /api/v1/cases, GET /api/v1/cases/:id, POST /api/v1/cases
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
import { getExecutionCaseDetail, listExecutionCasesForOrg } from '../services/case-read.ts'
import { toReadContext } from '../lib/read-context.ts'
import { PaginationQuerySchema } from '../lib/pagination-schemas.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'
import { eq, and } from 'drizzle-orm'

const router = new Hono<{ Variables: HonoVariables }>()

const CaseIdParamSchema = z.object({
  id: z.string().uuid('Invalid case ID.'),
})

const ListExecutionCasesQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['intake', 'active', 'suspended', 'closed', 'archived']).optional(),
  courtJurisdiction: z.string().max(200).optional(),
  q: z.string().max(200).optional(),
})

// -------------------------------------------------------------------------
// GET /api/v1/cases — Paginated execution case list
// -------------------------------------------------------------------------

router.get(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = ListExecutionCasesQuerySchema.safeParse(c.req.query())
    if (!parsed.success) {
      return unprocessable(c, 'Invalid query parameters.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const q = parsed.data

    const result = await listExecutionCasesForOrg(
      ctx,
      {
        ...(q.status !== undefined ? { status: q.status } : {}),
        ...(q.courtJurisdiction !== undefined ? { courtJurisdiction: q.courtJurisdiction } : {}),
        ...(q.q !== undefined ? { q: q.q } : {}),
      },
      {
        limit: q.limit,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      }
    )

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data.items, nextCursor: result.data.nextCursor }, 200)
  }
)

// -------------------------------------------------------------------------
// GET /api/v1/cases/:id — Execution case profile
// -------------------------------------------------------------------------

router.get(
  '/:id',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = CaseIdParamSchema.safeParse({ id: c.req.param('id') })
    if (!parsed.success) {
      return unprocessable(c, 'Invalid case ID.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const result = await getExecutionCaseDetail(ctx, parsed.data.id)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

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

// -------------------------------------------------------------------------
// PATCH /api/v1/cases/:id — Update an execution case
// -------------------------------------------------------------------------

const UpdateCaseSchema = CreateCaseSchema.omit({ clientId: true, openedAt: true }).partial()

router.patch(
  '/:id',
  authMiddleware,
  orgMiddleware,
  requireMinRole('lawyer'),
  async (c) => {
    const parsedParams = CaseIdParamSchema.safeParse({ id: c.req.param('id') })
    if (!parsedParams.success) {
      return unprocessable(c, 'Invalid case ID.', { issues: parsedParams.error.issues })
    }

    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(UpdateCaseSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const { updateCase } = await import('../services/case.ts')
    const result = await updateCase(ctx, parsedParams.data.id, parsed.data as import('../services/case.ts').UpdateCaseInput)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/cases/:id/force-scraping — Dispara o robô navegador para o caso
// -------------------------------------------------------------------------

router.post(
  '/:id/force-scraping',
  authMiddleware,
  orgMiddleware,
  requireMinRole('lawyer'),
  async (c) => {
    const parsed = CaseIdParamSchema.safeParse({ id: c.req.param('id') })
    if (!parsed.success) {
      return unprocessable(c, 'Invalid case ID.', { issues: parsed.error.issues })
    }

    const ctx = buildWriteContext(c, db)

    const { executionCases } = await import('@execflow/db/schema')
    const [execCase] = await db
      .select()
      .from(executionCases)
      .where(
        and(
          eq(executionCases.id, parsed.data.id),
          eq(executionCases.organizationId, ctx.organizationId)
        )
      )
    
    if (!execCase) {
      return unprocessable(c, 'Case not found')
    }
    
    // Dispara a sincronização via Jusbrasil: cria o log e emite o evento de domínio
    // (mesma fila usada por POST /:caseId/sync-tribunal).
    const { domainEvents, crawlerSyncLogs } = await import('@execflow/db/schema')
    const crypto = await import('crypto')

    const [log] = await db
      .insert(crawlerSyncLogs)
      .values({
        organizationId: ctx.organizationId,
        executionCaseId: execCase.id,
        status: 'pending',
        tribunalName: 'Jusbrasil',
        createdByUserId: ctx.userId,
      })
      .returning()

    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      eventType: 'crawler.sync.requested',
      aggregateId: log?.id ?? execCase.id,
      aggregateType: 'CrawlerSyncLog',
      correlationId: crypto.randomUUID(),
      actorType: 'user',
      actorId: ctx.userId,
      occurredAt: new Date(),
      payload: {
        logId: log?.id,
        executionCaseId: execCase.id,
        organizationId: ctx.organizationId,
        requestedByUserId: ctx.userId,
      },
    })

    return c.json({ success: true, message: 'Sincronização com o Jusbrasil enfileirada.' }, 202)
  }
)

export { router as casesRouter }
