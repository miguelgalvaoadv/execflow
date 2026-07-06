/**
 * Rotas internas — chamadas SÓ por processos do próprio ExecFlow (o worker),
 * nunca pelo navegador. Autenticadas por um segredo compartilhado
 * (INTERNAL_API_TOKEN), não por sessão de usuário.
 *
 * Por que existe: a cadeia de reanálise (IA de oportunidades, tier, stale,
 * prazo provisório) vive em apps/api. O worker (DataJud/DJEN) NÃO pode importar
 * de apps/api (fronteira arquitetural). Então o worker chama este endpoint para
 * disparar a MESMA cadeia testada, sem duplicar código.
 *
 * Montado em /api/v1/internal.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { ingestMovementsByCnj, type MovementItem } from '../services/movement-ingestion.ts'
import {
  registerDiscoveredProcesses,
  ensureAutosTask,
  type DiscoveredProcess,
} from '../services/case-registration.ts'
import { db } from '../lib/db.ts'
import { executionCases, memberships, users, organizations } from '@execflow/db/schema'
import type { HonoVariables } from '../context/types.ts'

export const internalRouter = new Hono<{ Variables: HonoVariables }>()

/** Guard: segredo compartilhado no header X-Internal-Token. */
internalRouter.use('*', async (c, next) => {
  const expected = process.env['INTERNAL_API_TOKEN']
  if (!expected) {
    return c.json({ error: 'Internal API disabled (INTERNAL_API_TOKEN ausente).' }, 503)
  }
  const got = c.req.header('X-Internal-Token')
  if (got !== expected) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})

const MovementSchema = z.object({
  tipo: z.string().max(300),
  conteudo: z.string().max(20000),
  occurredAt: z.string(),
  source: z.string().max(30),
  kind: z.enum(['movimentacao', 'intimacao']),
  dedupKey: z.string().max(300),
  link: z.string().max(2000).nullable().optional(),
})

const IngestSchema = z.object({
  cnj: z.string().min(5).max(60),
  movements: z.array(MovementSchema).min(1).max(200),
})

/**
 * POST /api/v1/internal/case-movements
 * Recebe movimentações/intimações de uma fonte (DataJud, DJEN) e roda a
 * reanálise completa no caso correspondente (se existir).
 */
internalRouter.post('/case-movements', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = IngestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido', issues: parsed.error.issues }, 400)
  }

  const items: MovementItem[] = parsed.data.movements.map((m) => ({
    tipo: m.tipo,
    conteudo: m.conteudo,
    occurredAt: new Date(m.occurredAt),
    source: m.source,
    kind: m.kind,
    dedupKey: m.dedupKey,
    link: m.link ?? null,
    rawPayload: m,
  }))

  const { matched, results, orphaned } = await ingestMovementsByCnj(parsed.data.cnj, items)

  const processed = results.filter((r) => r.status === 'processed')
  return c.json({
    matched,
    orphaned,
    total: results.length,
    processed: processed.length,
    duplicates: results.length - processed.length,
    markedStale: processed.some((r) => r.markedStale),
    opportunitiesCreated: processed.reduce((n, r) => n + r.opportunitiesCreated, 0),
    tiers: processed.map((r) => r.criticalityTier),
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/internal/register-cases
// Registra em massa processos descobertos (InfoSimples por OAB) como casos,
// cria o cliente (executado), insere movimentações e cria o pedido de autos.
// ---------------------------------------------------------------------------

const ProcessSchema = z.object({
  cnj: z.string().min(5).max(60),
  clientName: z.string().max(300).nullable().optional(),
  courtName: z.string().max(300).nullable().optional(),
  jurisdiction: z.string().max(200).nullable().optional(),
  classe: z.string().max(200).nullable().optional(),
  source: z.string().max(30),
  movements: z
    .array(z.object({ data: z.string().max(20), texto: z.string().max(4000) }))
    .max(50)
    .default([]),
})

const RegisterSchema = z.object({
  processes: z.array(ProcessSchema).min(1).max(50),
})

internalRouter.post('/register-cases', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = RegisterSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido', issues: parsed.error.issues }, 400)
  }
  const processes: DiscoveredProcess[] = parsed.data.processes.map((p) => ({
    cnj: p.cnj,
    clientName: p.clientName ?? null,
    courtName: p.courtName ?? null,
    jurisdiction: p.jurisdiction ?? null,
    classe: p.classe ?? null,
    source: p.source,
    movements: p.movements,
  }))
  const result = await registerDiscoveredProcesses(processes)
  return c.json({ data: result })
})

// ---------------------------------------------------------------------------
// POST /api/v1/internal/backfill-autos-tasks
// Garante o "pedido de autos" para TODO caso ativo sem autos (spec: todos os
// clientes precisam do pedido de autos para melhorar prazos/oportunidades).
// ---------------------------------------------------------------------------

internalRouter.post('/backfill-autos-tasks', async (c) => {
  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1)
  if (!org) return c.json({ data: { created: 0 } })
  const [actor] = await db
    .select({ userId: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, org.id))
    .limit(1)
  if (!actor) return c.json({ data: { created: 0 } })

  const cases = await db
    .select({ id: executionCases.id })
    .from(executionCases)
    .where(
      and(
        eq(executionCases.organizationId, org.id),
        inArray(executionCases.status, ['intake', 'active', 'suspended']),
        isNull(executionCases.deletedAt)
      )
    )

  const before = { created: 0 } as { created: number }
  const dummy = {
    clientsCreated: 0, casesCreated: 0, casesExisting: 0, casesArchived: 0,
    movementsInserted: 0, autosTasksCreated: 0, skipped: 0,
  }
  for (const cs of cases) {
    await ensureAutosTask(org.id, cs.id, actor.userId, dummy)
  }
  before.created = dummy.autosTasksCreated
  return c.json({ data: { evaluated: cases.length, tasksCreated: before.created } })
})
