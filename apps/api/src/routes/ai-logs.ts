/**
 * Histórico da IA — trilha de auditoria de todas as chamadas ao Claude.
 *
 * ACESSO RESTRITO (LGPD): prompt/resposta podem conter dados sensíveis dos
 * autos — somente lawyer/admin. Montado em /api/v1/ai-logs.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { aiInteractionLogs } from '@execflow/db/schema'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const aiLogsRouter = new Hono<{ Variables: HonoVariables }>()

aiLogsRouter.use('*', authMiddleware, orgMiddleware)

const ListQuerySchema = z.object({
  agent: z.string().max(50).optional(),
  status: z.enum(['success', 'error']).optional(),
  executionCaseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

aiLogsRouter.get('/', requireMinRole('lawyer'), async (c) => {
  const parsed = ListQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return unprocessable(c, 'Parâmetros inválidos.', { issues: parsed.error.issues })
  }
  const { organization } = c.get('org')
  const q = parsed.data

  const conditions = [eq(aiInteractionLogs.organizationId, organization.id)]
  if (q.agent) conditions.push(eq(aiInteractionLogs.agent, q.agent))
  if (q.status) conditions.push(eq(aiInteractionLogs.status, q.status))
  if (q.executionCaseId) conditions.push(eq(aiInteractionLogs.executionCaseId, q.executionCaseId))

  const rows = await db
    .select()
    .from(aiInteractionLogs)
    .where(and(...conditions))
    .orderBy(desc(aiInteractionLogs.createdAt))
    .limit(q.limit)
    .offset(q.offset)

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${aiInteractionLogs.status} = 'error')::int`,
      inputTokens: sql<number>`coalesce(sum(${aiInteractionLogs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiInteractionLogs.outputTokens}), 0)::int`,
      estimatedCostUsd: sql<string>`coalesce(sum(${aiInteractionLogs.estimatedCostUsd}), 0)::text`,
    })
    .from(aiInteractionLogs)
    .where(eq(aiInteractionLogs.organizationId, organization.id))

  return c.json({ data: rows, totals: totals ?? null })
})
