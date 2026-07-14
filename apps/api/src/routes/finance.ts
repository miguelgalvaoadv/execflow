/**
 * Financial entries routes — módulo Financeiro (ledger manual por cliente).
 *
 * GET   /api/v1/finance/entries?clientId=...   — lista lançamentos do cliente + resumo
 * POST  /api/v1/finance/entries                — criar lançamento
 * PATCH /api/v1/finance/entries/:id             — editar lançamento (sempre editável)
 *
 * DESIGN:
 * - Sem máquina de estados: qualquer campo pode ser editado a qualquer momento
 *   (PATCH parcial), inclusive marcar como pago/cancelado.
 * - "Atrasado" é computado na leitura (status='pending' + dueDate no passado),
 *   nunca armazenado — evita ficar desatualizado sem job.
 * - Resumo (totais por direção/status) computado aqui, não no frontend, pra
 *   manter a lógica de data/moeda num único lugar.
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
import { unprocessable } from '../lib/respond.ts'
import {
  listFinancialEntriesByClient,
  insertFinancialEntry,
  updateFinancialEntry,
} from '../repositories/financial-entry.ts'
import type { HonoVariables } from '../context/types.ts'
import type { FinancialEntry } from '@execflow/db/schema'

const router = new Hono<{ Variables: HonoVariables }>()

const DIRECTIONS = ['receivable', 'expense'] as const
const STATUSES = ['pending', 'paid', 'cancelled'] as const

function isOverdue(entry: FinancialEntry): boolean {
  if (entry.status !== 'pending' || entry.dueDate === null) return false
  return entry.dueDate < new Date().toISOString().slice(0, 10)
}

function summarize(entries: FinancialEntry[]) {
  const summary = {
    receivablePending: 0,
    receivablePaid: 0,
    receivableOverdue: 0,
    expensePending: 0,
    expensePaid: 0,
  }
  for (const e of entries) {
    const amount = Number(e.amount)
    if (e.direction === 'receivable') {
      if (e.status === 'paid') summary.receivablePaid += amount
      else if (e.status === 'pending') {
        summary.receivablePending += amount
        if (isOverdue(e)) summary.receivableOverdue += amount
      }
    } else if (e.direction === 'expense') {
      if (e.status === 'paid') summary.expensePaid += amount
      else if (e.status === 'pending') summary.expensePending += amount
    }
  }
  return summary
}

// -------------------------------------------------------------------------
// GET /api/v1/finance/entries?clientId=... — lista + resumo
// -------------------------------------------------------------------------

const ListEntriesQuerySchema = z.object({
  clientId: z.string().uuid(),
})

router.get(
  '/entries',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = ListEntriesQuerySchema.safeParse(c.req.query())
    if (!parsed.success) {
      return unprocessable(c, 'clientId (uuid) é obrigatório.', { issues: parsed.error.issues })
    }
    const ctx = buildWriteContext(c, db)

    const result = await listFinancialEntriesByClient(ctx.db, ctx.organizationId, parsed.data.clientId)
    if (!result.success) {
      return serviceErrorToResponse(c, { code: 'INTERNAL', message: result.error.message })
    }

    const items = result.data.map((e) => ({ ...e, isOverdue: isOverdue(e) }))

    return c.json({ data: items, summary: summarize(result.data) })
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/finance/entries — criar lançamento
// -------------------------------------------------------------------------

const CreateEntrySchema = z.object({
  clientId: z.string().uuid(),
  executionCaseId: z.string().uuid().optional(),
  direction: z.enum(DIRECTIONS),
  category: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  amount: z.number().positive().max(100_000_000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentMethod: z.string().max(50).optional(),
  status: z.enum(STATUSES).default('pending'),
  paidAt: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(5000).optional(),
})

router.post(
  '/entries',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const body = await safeJsonBody(c)
    const parsed = parseBody(CreateEntrySchema, body ?? {})
    if (!parsed.success) {
      return unprocessable(c, parsed.message)
    }
    const ctx = buildWriteContext(c, db)
    const b = parsed.data

    const result = await insertFinancialEntry(ctx.db, {
      organizationId: ctx.organizationId,
      clientId: b.clientId,
      executionCaseId: b.executionCaseId ?? null,
      direction: b.direction,
      category: b.category,
      description: b.description,
      amount: b.amount.toFixed(2),
      dueDate: b.dueDate ?? null,
      paymentMethod: b.paymentMethod ?? null,
      status: b.status,
      paidAt: b.paidAt ? new Date(b.paidAt) : b.status === 'paid' ? new Date() : null,
      notes: b.notes ?? null,
      createdByUserId: ctx.userId,
    })

    if (!result.success) {
      return serviceErrorToResponse(c, { code: 'INTERNAL', message: result.error.message })
    }

    return c.json({ data: { ...result.data, isOverdue: isOverdue(result.data) } }, 201)
  }
)

// -------------------------------------------------------------------------
// PATCH /api/v1/finance/entries/:id — editar (sempre editável)
// -------------------------------------------------------------------------

const UpdateEntrySchema = z.object({
  executionCaseId: z.string().uuid().nullable().optional(),
  direction: z.enum(DIRECTIONS).optional(),
  category: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  amount: z.number().positive().max(100_000_000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paymentMethod: z.string().max(50).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  paidAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

router.patch(
  '/entries/:id',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const id = c.req.param('id')
    const body = await safeJsonBody(c)
    const parsed = parseBody(UpdateEntrySchema, body ?? {})
    if (!parsed.success) {
      return unprocessable(c, parsed.message)
    }
    const ctx = buildWriteContext(c, db)
    const b = parsed.data

    // Marcar como 'paid' sem paidAt explícito preenche a data agora.
    const paidAtUpdate =
      b.paidAt !== undefined
        ? { paidAt: b.paidAt === null ? null : new Date(b.paidAt) }
        : b.status === 'paid'
          ? { paidAt: new Date() }
          : {}

    const result = await updateFinancialEntry(ctx.db, ctx.organizationId, id, {
      ...(b.executionCaseId !== undefined ? { executionCaseId: b.executionCaseId } : {}),
      ...(b.direction !== undefined ? { direction: b.direction } : {}),
      ...(b.category !== undefined ? { category: b.category } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.amount !== undefined ? { amount: b.amount.toFixed(2) } : {}),
      ...(b.dueDate !== undefined ? { dueDate: b.dueDate } : {}),
      ...(b.paymentMethod !== undefined ? { paymentMethod: b.paymentMethod } : {}),
      ...(b.status !== undefined ? { status: b.status } : {}),
      ...(b.notes !== undefined ? { notes: b.notes } : {}),
      ...paidAtUpdate,
    })

    if (!result.success) {
      return serviceErrorToResponse(c, { code: result.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL', message: result.error.message })
    }

    return c.json({ data: { ...result.data, isOverdue: isOverdue(result.data) } }, 200)
  }
)

export { router as financeRouter }
