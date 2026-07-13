/**
 * Intimações / comunicações oficiais — listagem e triagem.
 *
 * SEPARAÇÃO DE FONTES (spec): intimações são uma entidade própria
 * (court_communications), diferente de movimentações (timeline_events) e de
 * autos (documents). Aqui o advogado vê o que chegou do DJEN/InfoSimples/
 * manual e marca o que já viu. Achado 13/07/2026: só entra aqui o que É de
 * fato um ato de comunicação (intimação/publicação/citação), não qualquer
 * movimentação — ver isFormalCommunication em services/movement-ingestion.ts.
 *
 * ESCOPO 13/07/2026: o painel só mostra processos CADASTRADOS — não existe
 * mais "órfã" (ver findRegisteredCase em movement-ingestion.ts: itens de
 * processo não cadastrado são descartados antes de chegar aqui). Toda
 * comunicação que entra já está vinculada a um caso, com status='new'
 * (ainda não vista pelo advogado) até alguém marcar como vista.
 *
 * Montado em /api/v1/communications
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc, sql, ilike, or } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { courtCommunications, executionCases, clients } from '@execflow/db/schema'
import { unprocessable, notFound } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const communicationsRouter = new Hono<{ Variables: HonoVariables }>()

communicationsRouter.use('*', authMiddleware, orgMiddleware)

const ListQuerySchema = z.object({
  status: z.enum(['new', 'processed', 'dismissed']).optional(),
  kind: z.string().max(30).optional(),
  possibleDeadline: z.enum(['true', 'false']).optional(),
  /** Filtra pra um caso específico — usada pela aba Intimações da tela do caso. */
  executionCaseId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
})

// ---------------------------------------------------------------------------
// GET / — lista intimações com filtros
// ---------------------------------------------------------------------------

communicationsRouter.get('/', requireMinRole('assistant'), async (c) => {
  const parsed = ListQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return unprocessable(c, 'Parâmetros inválidos.', { issues: parsed.error.issues })
  }
  const { organization } = c.get('org')
  const q = parsed.data

  const conditions = [eq(courtCommunications.organizationId, organization.id)]
  if (q.status) conditions.push(eq(courtCommunications.status, q.status))
  if (q.kind) conditions.push(eq(courtCommunications.kind, q.kind))
  if (q.possibleDeadline === 'true') conditions.push(eq(courtCommunications.possibleDeadline, true))
  if (q.executionCaseId) conditions.push(eq(courtCommunications.executionCaseId, q.executionCaseId))
  if (q.q) {
    const term = `%${q.q}%`
    const search = or(
      ilike(courtCommunications.processNumber, term),
      ilike(courtCommunications.content, term)
    )
    if (search) conditions.push(search)
  }

  // Achado 13/07/2026 (Miguel: "poderiam vir com o nome ali além do número do
  // processo"): join com execution_cases/clients quando já há caso vinculado
  // — a tela mostrava só o CNJ, obrigando abrir o caso pra saber de quem é.
  const rows = await db
    .select({
      comm: courtCommunications,
      clientName: clients.fullName,
      caseInternalRef: executionCases.internalRef,
    })
    .from(courtCommunications)
    .leftJoin(executionCases, eq(courtCommunications.executionCaseId, executionCases.id))
    .leftJoin(clients, eq(executionCases.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(desc(courtCommunications.createdAt))
    .limit(q.limit)
    .then((results) =>
      results.map((r) => ({ ...r.comm, clientName: r.clientName, caseInternalRef: r.caseInternalRef }))
    )

  // Contadores seguem o mesmo escopo (org, ou org+caso quando a aba é a de
  // um caso específico) — mas ignoram status/kind/busca, senão os cards
  // ficariam instáveis conforme o filtro da lista abaixo muda.
  const counterConditions = [eq(courtCommunications.organizationId, organization.id)]
  if (q.executionCaseId) counterConditions.push(eq(courtCommunications.executionCaseId, q.executionCaseId))

  const [counters] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unprocessed: sql<number>`count(*) filter (where ${courtCommunications.status} = 'new')::int`,
      withDeadline: sql<number>`count(*) filter (where ${courtCommunications.possibleDeadline} = true and ${courtCommunications.status} not in ('dismissed'))::int`,
    })
    .from(courtCommunications)
    .where(and(...counterConditions))

  return c.json({ data: rows, counters: counters ?? null })
})

// ---------------------------------------------------------------------------
// POST /:id/resolve — marcar como vista/não vista ou irrelevante
// ---------------------------------------------------------------------------

const ResolveSchema = z.union([
  z.object({ action: z.literal('mark_seen') }),
  z.object({ action: z.literal('mark_unseen') }),
  z.object({ action: z.literal('dismiss'), notes: z.string().max(2000).optional() }),
])

communicationsRouter.post('/:id/resolve', requireMinRole('lawyer'), async (c) => {
  const commId = c.req.param('id')
  const { organization, domainUserId } = c.get('org')

  const body = await c.req.json().catch(() => null)
  const parsed = ResolveSchema.safeParse(body)
  if (!parsed.success) {
    return unprocessable(c, 'Corpo inválido.', { issues: parsed.error.issues })
  }

  const [comm] = await db
    .select()
    .from(courtCommunications)
    .where(and(eq(courtCommunications.id, commId), eq(courtCommunications.organizationId, organization.id)))
    .limit(1)

  if (!comm) return notFound(c, 'Intimação não encontrada.')

  if (parsed.data.action === 'dismiss') {
    await db
      .update(courtCommunications)
      .set({
        status: 'dismissed',
        reviewedAt: new Date(),
        reviewedByUserId: domainUserId,
        updatedAt: new Date(),
      })
      .where(eq(courtCommunications.id, commId))
    return c.json({ data: { resolved: true, action: 'dismiss' } })
  }

  if (parsed.data.action === 'mark_seen') {
    await db
      .update(courtCommunications)
      .set({
        status: 'processed',
        reviewedAt: new Date(),
        reviewedByUserId: domainUserId,
        updatedAt: new Date(),
      })
      .where(eq(courtCommunications.id, commId))
    return c.json({ data: { resolved: true, action: 'mark_seen' } })
  }

  // action === 'mark_unseen'
  await db
    .update(courtCommunications)
    .set({
      status: 'new',
      reviewedAt: null,
      reviewedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(courtCommunications.id, commId))
  return c.json({ data: { resolved: true, action: 'mark_unseen' } })
})
