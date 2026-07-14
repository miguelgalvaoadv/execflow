/**
 * Agenda / Calendário — GET agregado (eventos manuais + prazos + oportunidades)
 * e CRUD dos eventos manuais. Pedido do Miguel 13/07/2026.
 *
 * DECISÃO: calendário NATIVO (não Google Calendar via MCP) — dado de execução
 * penal não sai pra terceiros, e prazos/oportunidades já vivem no Postgres, então
 * a agregação é local e ao vivo. Prazos e oportunidades NÃO são copiados pra
 * calendar_events; são lidos das próprias tabelas e mesclados aqui por período.
 * Só o botão "Adicionar à agenda" materializa um vínculo (calendar_events com
 * sourceType) — um lembrete fixado que não altera o prazo original.
 *
 * Montado em /api/v1/calendar.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, inArray, ne } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import {
  calendarEvents,
  deadlines,
  opportunities,
  executionCases,
  clients,
} from '@execflow/db/schema'
import { unprocessable, notFound } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const calendarRouter = new Hono<{ Variables: HonoVariables }>()

calendarRouter.use('*', authMiddleware, orgMiddleware)

// ---------------------------------------------------------------------------
// Tipo unificado devolvido pra tela — cada item já sabe se é editável.
// ---------------------------------------------------------------------------
type CalendarItem = {
  id: string
  kind: 'manual' | 'deadline' | 'opportunity'
  eventKind: string | null
  title: string
  description: string | null
  startsAt: string
  endsAt: string | null
  allDay: boolean
  location: string | null
  color: string | null
  executionCaseId: string | null
  clientName: string | null
  processNumber: string | null
  /** Só para prazos. */
  deadlineStatus: string | null
  deadlinePriority: string | null
  /** Só para oportunidades. */
  opportunityType: string | null
  sourceType: string | null
  sourceId: string | null
  editable: boolean
}

const ListQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  layers: z.string().optional(), // csv: manual,deadlines,opportunities
})

// ---------------------------------------------------------------------------
// GET / — itens do calendário num intervalo [from, to]
// ---------------------------------------------------------------------------

calendarRouter.get('/', requireMinRole('assistant'), async (c) => {
  const parsed = ListQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return unprocessable(c, 'Parâmetros inválidos (from/to são obrigatórios, ISO 8601).', {
      issues: parsed.error.issues,
    })
  }
  const { organization } = c.get('org')
  const from = new Date(parsed.data.from)
  const to = new Date(parsed.data.to)
  const layers = new Set(
    (parsed.data.layers ?? 'manual,deadlines,opportunities').split(',').map((s) => s.trim())
  )

  const items: CalendarItem[] = []
  const linkedDeadlineIds = new Set<string>()
  const linkedOpportunityIds = new Set<string>()

  // 1) Eventos manuais (sempre) — inclui os vínculos "Adicionar à agenda".
  if (layers.has('manual')) {
    const rows = await db
      .select({
        ev: calendarEvents,
        clientName: clients.fullName,
        processNumber: executionCases.executionProcessNumber,
      })
      .from(calendarEvents)
      .leftJoin(executionCases, eq(calendarEvents.executionCaseId, executionCases.id))
      .leftJoin(clients, eq(executionCases.clientId, clients.id))
      .where(
        and(
          eq(calendarEvents.organizationId, organization.id),
          gte(calendarEvents.startsAt, from),
          lte(calendarEvents.startsAt, to)
        )
      )
    for (const r of rows) {
      if (r.ev.sourceDeadlineId) linkedDeadlineIds.add(r.ev.sourceDeadlineId)
      if (r.ev.sourceOpportunityId) linkedOpportunityIds.add(r.ev.sourceOpportunityId)
      items.push({
        id: r.ev.id,
        kind: 'manual',
        eventKind: r.ev.eventKind,
        title: r.ev.title,
        description: r.ev.description,
        startsAt: r.ev.startsAt.toISOString(),
        endsAt: r.ev.endsAt ? r.ev.endsAt.toISOString() : null,
        allDay: r.ev.allDay,
        location: r.ev.location,
        color: r.ev.color,
        executionCaseId: r.ev.executionCaseId,
        clientName: r.clientName,
        processNumber: r.processNumber,
        deadlineStatus: null,
        deadlinePriority: null,
        opportunityType: null,
        sourceType: r.ev.sourceType,
        sourceId: r.ev.sourceDeadlineId ?? r.ev.sourceOpportunityId ?? null,
        editable: true,
      })
    }
  }

  // 2) Prazos (camada ao vivo) — pela data de vencimento; pula os já vinculados.
  if (layers.has('deadlines')) {
    const rows = await db
      .select({
        id: deadlines.id,
        title: deadlines.title,
        description: deadlines.description,
        dueAt: deadlines.dueAt,
        status: deadlines.status,
        priority: deadlines.priority,
        executionCaseId: deadlines.executionCaseId,
        clientName: clients.fullName,
        processNumber: executionCases.executionProcessNumber,
      })
      .from(deadlines)
      .innerJoin(executionCases, eq(deadlines.executionCaseId, executionCases.id))
      .innerJoin(clients, eq(executionCases.clientId, clients.id))
      .where(
        and(
          eq(deadlines.organizationId, organization.id),
          gte(deadlines.dueAt, from),
          lte(deadlines.dueAt, to),
          ne(deadlines.status, 'dismissed')
        )
      )
    for (const r of rows) {
      if (linkedDeadlineIds.has(r.id)) continue
      items.push({
        id: r.id,
        kind: 'deadline',
        eventKind: null,
        title: r.title,
        description: r.description,
        startsAt: r.dueAt.toISOString(),
        endsAt: null,
        allDay: true,
        location: null,
        color: null,
        executionCaseId: r.executionCaseId,
        clientName: r.clientName,
        processNumber: r.processNumber,
        deadlineStatus: r.status,
        deadlinePriority: r.priority,
        opportunityType: null,
        sourceType: 'deadline',
        sourceId: r.id,
        editable: false,
      })
    }
  }

  // 3) Oportunidades (camada ao vivo) — pela janela (windowEndAt); pula vinculadas.
  if (layers.has('opportunities')) {
    const rows = await db
      .select({
        id: opportunities.id,
        summary: opportunities.summary,
        windowEndAt: opportunities.windowEndAt,
        opportunityType: opportunities.opportunityType,
        status: opportunities.status,
        executionCaseId: opportunities.executionCaseId,
        clientName: clients.fullName,
        processNumber: executionCases.executionProcessNumber,
      })
      .from(opportunities)
      .innerJoin(executionCases, eq(opportunities.executionCaseId, executionCases.id))
      .innerJoin(clients, eq(executionCases.clientId, clients.id))
      .where(
        and(
          eq(opportunities.organizationId, organization.id),
          inArray(opportunities.status, ['suggested', 'qualified', 'pursuing']),
          gte(opportunities.windowEndAt, from),
          lte(opportunities.windowEndAt, to)
        )
      )
    for (const r of rows) {
      if (!r.windowEndAt) continue
      if (linkedOpportunityIds.has(r.id)) continue
      items.push({
        id: r.id,
        kind: 'opportunity',
        eventKind: null,
        title: r.summary,
        description: null,
        startsAt: r.windowEndAt.toISOString(),
        endsAt: null,
        allDay: true,
        location: null,
        color: null,
        executionCaseId: r.executionCaseId,
        clientName: r.clientName,
        processNumber: r.processNumber,
        deadlineStatus: null,
        deadlinePriority: null,
        opportunityType: r.opportunityType,
        sourceType: 'opportunity',
        sourceId: r.id,
        editable: false,
      })
    }
  }

  items.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return c.json({ data: items })
})

// ---------------------------------------------------------------------------
// POST / — cria evento manual OU vincula um prazo/oportunidade ("Adic. à agenda")
// ---------------------------------------------------------------------------

const CreateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(4000).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(255).nullable().optional(),
  eventKind: z.string().max(40).optional(),
  color: z.string().max(40).nullable().optional(),
  executionCaseId: z.string().uuid().nullable().optional(),
  sourceDeadlineId: z.string().uuid().optional(),
  sourceOpportunityId: z.string().uuid().optional(),
})

calendarRouter.post('/', requireMinRole('assistant'), async (c) => {
  const { organization, domainUserId } = c.get('org')
  const body = await c.req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return unprocessable(c, 'Corpo inválido.', { issues: parsed.error.issues })
  }
  const b = parsed.data

  // --- Vínculo a partir de um PRAZO ("Adicionar à agenda") ---
  if (b.sourceDeadlineId) {
    const [dl] = await db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.id, b.sourceDeadlineId), eq(deadlines.organizationId, organization.id)))
      .limit(1)
    if (!dl) return unprocessable(c, 'Prazo não encontrado nesta organização.')

    // Idempotente: se já foi adicionado, devolve o existente.
    const [existing] = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.organizationId, organization.id),
          eq(calendarEvents.sourceDeadlineId, dl.id)
        )
      )
      .limit(1)
    if (existing) return c.json({ data: existing, alreadyExisted: true })

    const [created] = await db
      .insert(calendarEvents)
      .values({
        organizationId: organization.id,
        executionCaseId: dl.executionCaseId,
        title: b.title ?? `Prazo: ${dl.title}`.substring(0, 255),
        description: b.description ?? dl.description ?? null,
        startsAt: b.startsAt ? new Date(b.startsAt) : dl.dueAt,
        allDay: true,
        eventKind: 'deadline_link',
        sourceType: 'deadline',
        sourceDeadlineId: dl.id,
        createdByUserId: domainUserId,
      })
      .returning()
    return c.json({ data: created }, 201)
  }

  // --- Vínculo a partir de uma OPORTUNIDADE ("Adicionar à agenda") ---
  if (b.sourceOpportunityId) {
    const [op] = await db
      .select()
      .from(opportunities)
      .where(
        and(eq(opportunities.id, b.sourceOpportunityId), eq(opportunities.organizationId, organization.id))
      )
      .limit(1)
    if (!op) return unprocessable(c, 'Oportunidade não encontrada nesta organização.')

    const [existing] = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.organizationId, organization.id),
          eq(calendarEvents.sourceOpportunityId, op.id)
        )
      )
      .limit(1)
    if (existing) return c.json({ data: existing, alreadyExisted: true })

    const [created] = await db
      .insert(calendarEvents)
      .values({
        organizationId: organization.id,
        executionCaseId: op.executionCaseId,
        title: b.title ?? `Oportunidade: ${op.summary}`.substring(0, 255),
        description: b.description ?? null,
        startsAt: b.startsAt ? new Date(b.startsAt) : (op.windowEndAt ?? new Date()),
        allDay: true,
        eventKind: 'opportunity_link',
        sourceType: 'opportunity',
        sourceOpportunityId: op.id,
        createdByUserId: domainUserId,
      })
      .returning()
    return c.json({ data: created }, 201)
  }

  // --- Evento manual comum ---
  if (!b.title || !b.startsAt) {
    return unprocessable(c, 'Evento manual exige título e data (startsAt).')
  }
  const [created] = await db
    .insert(calendarEvents)
    .values({
      organizationId: organization.id,
      executionCaseId: b.executionCaseId ?? null,
      title: b.title.substring(0, 255),
      description: b.description ?? null,
      startsAt: new Date(b.startsAt),
      endsAt: b.endsAt ? new Date(b.endsAt) : null,
      allDay: b.allDay ?? true,
      location: b.location ?? null,
      eventKind: b.eventKind ?? 'manual',
      color: b.color ?? null,
      createdByUserId: domainUserId,
    })
    .returning()
  return c.json({ data: created }, 201)
})

// ---------------------------------------------------------------------------
// PATCH /:id — edita um evento manual (não mexe em prazo/oportunidade de origem)
// ---------------------------------------------------------------------------

const UpdateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(4000).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(255).nullable().optional(),
  eventKind: z.string().max(40).optional(),
  color: z.string().max(40).nullable().optional(),
  executionCaseId: z.string().uuid().nullable().optional(),
})

calendarRouter.patch('/:id', requireMinRole('assistant'), async (c) => {
  const { organization } = c.get('org')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return unprocessable(c, 'Corpo inválido.', { issues: parsed.error.issues })
  }
  const [existing] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.organizationId, organization.id)))
    .limit(1)
  if (!existing) return notFound(c, 'Evento não encontrado.')

  const b = parsed.data
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (b.title !== undefined) patch['title'] = b.title.substring(0, 255)
  if (b.description !== undefined) patch['description'] = b.description
  if (b.startsAt !== undefined) patch['startsAt'] = new Date(b.startsAt)
  if (b.endsAt !== undefined) patch['endsAt'] = b.endsAt ? new Date(b.endsAt) : null
  if (b.allDay !== undefined) patch['allDay'] = b.allDay
  if (b.location !== undefined) patch['location'] = b.location
  if (b.eventKind !== undefined) patch['eventKind'] = b.eventKind
  if (b.color !== undefined) patch['color'] = b.color
  if (b.executionCaseId !== undefined) patch['executionCaseId'] = b.executionCaseId

  const [updated] = await db
    .update(calendarEvents)
    .set(patch)
    .where(eq(calendarEvents.id, id))
    .returning()
  return c.json({ data: updated })
})

// ---------------------------------------------------------------------------
// DELETE /:id — remove um evento manual/vínculo (não afeta o prazo original)
// ---------------------------------------------------------------------------

calendarRouter.delete('/:id', requireMinRole('assistant'), async (c) => {
  const { organization } = c.get('org')
  const id = c.req.param('id')
  const [existing] = await db
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.organizationId, organization.id)))
    .limit(1)
  if (!existing) return notFound(c, 'Evento não encontrado.')
  await db.delete(calendarEvents).where(eq(calendarEvents.id, id))
  return c.json({ data: { deleted: true } })
})
