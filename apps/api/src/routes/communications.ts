/**
 * Intimações / comunicações oficiais — listagem e triagem.
 *
 * SEPARAÇÃO DE FONTES (spec): intimações são uma entidade própria
 * (court_communications), diferente de movimentações (timeline_events) e de
 * autos (documents). Aqui o advogado vê o que chegou do DJEN/InfoSimples/
 * manual, resolve órfãs e marca irrelevantes. Achado 13/07/2026: só entra
 * aqui o que É de fato um ato de comunicação (intimação/publicação/citação),
 * não qualquer movimentação — ver isFormalCommunication em
 * services/movement-ingestion.ts.
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
import { courtCommunications, executionCases, timelineEvents, clients } from '@execflow/db/schema'
import { unprocessable, notFound } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const communicationsRouter = new Hono<{ Variables: HonoVariables }>()

communicationsRouter.use('*', authMiddleware, orgMiddleware)

const ListQuerySchema = z.object({
  status: z.enum(['new', 'processed', 'orphan', 'dismissed']).optional(),
  kind: z.string().max(30).optional(),
  possibleDeadline: z.enum(['true', 'false']).optional(),
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

  const [counters] = await db
    .select({
      total: sql<number>`count(*)::int`,
      orphan: sql<number>`count(*) filter (where ${courtCommunications.status} = 'orphan')::int`,
      unprocessed: sql<number>`count(*) filter (where ${courtCommunications.status} = 'new')::int`,
      withDeadline: sql<number>`count(*) filter (where ${courtCommunications.possibleDeadline} = true and ${courtCommunications.status} not in ('dismissed'))::int`,
    })
    .from(courtCommunications)
    .where(eq(courtCommunications.organizationId, organization.id))

  return c.json({ data: rows, counters: counters ?? null })
})

// ---------------------------------------------------------------------------
// POST /:id/resolve — vincular a um caso ou marcar como irrelevante
// ---------------------------------------------------------------------------

const ResolveSchema = z.union([
  z.object({ action: z.literal('link'), executionCaseId: z.string().uuid() }),
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

  // action === 'link' — vincula ao caso e materializa a movimentação na timeline
  const [execCase] = await db
    .select()
    .from(executionCases)
    .where(
      and(
        eq(executionCases.id, parsed.data.executionCaseId),
        eq(executionCases.organizationId, organization.id)
      )
    )
    .limit(1)

  if (!execCase) return unprocessable(c, 'Caso não encontrado nesta organização.')

  const summary = `Intimação vinculada manualmente: ${(comm.content ?? '').substring(0, 200)}`
  const [newEvent] = await db
    .insert(timelineEvents)
    .values({
      organizationId: organization.id,
      executionCaseId: execCase.id,
      eventCategory: 'court',
      eventType: 'process_movement',
      occurredAt: comm.availableAt ?? comm.createdAt,
      summary: summary.substring(0, 255),
      source: 'integration',
      actorType: 'user',
      actorId: domainUserId,
      sourceRefType: 'CourtCommunication',
      sourceRefId: comm.id,
    })
    .returning()

  await db
    .update(courtCommunications)
    .set({
      status: 'processed',
      executionCaseId: execCase.id,
      reviewedAt: new Date(),
      reviewedByUserId: domainUserId,
      updatedAt: new Date(),
    })
    .where(eq(courtCommunications.id, commId))

  return c.json({ data: { resolved: true, action: 'link', timelineEventId: newEvent?.id ?? null } })
})
