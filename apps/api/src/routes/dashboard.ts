/**
 * Dashboard — resumo operacional com CONTAGENS REAIS (COUNT no banco).
 *
 * A dashboard antiga contava o tamanho da página (máx. 50) das listas, então
 * um número "50" podia esconder 200. Aqui cada métrica é um COUNT(*) real,
 * org-scoped, direto das tabelas de domínio — o número na tela é o número.
 *
 * GET /api/v1/dashboard/summary
 */

import { Hono } from 'hono'
import { and, eq, gte, lt, sql, inArray, isNull } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import {
  executionCases,
  clients,
  courtCommunications,
  deadlines,
  workflowTasks,
  opportunities,
  calendarEvents,
} from '@execflow/db/schema'
import type { HonoVariables } from '../context/types.ts'

export const dashboardRouter = new Hono<{ Variables: HonoVariables }>()

dashboardRouter.use('*', authMiddleware, orgMiddleware)

dashboardRouter.get('/summary', requireMinRole('assistant'), async (c) => {
  const { organization } = c.get('org')
  const orgId = organization.id

  const nowPlus7 = sql`now() + interval '7 days'`
  const todayStart = sql`date_trunc('day', now())`
  const tomorrowStart = sql`date_trunc('day', now()) + interval '1 day'`

  const [
    [activeCases],
    [activeClients],
    [newIntimations],
    [overdueDeadlines],
    [weekDeadlines],
    [openTasks],
    [openOpportunities],
    [todayEvents],
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(executionCases)
      .where(and(eq(executionCases.organizationId, orgId), eq(executionCases.status, 'active'))),
    db.select({ n: sql<number>`count(*)::int` }).from(clients)
      .where(and(eq(clients.organizationId, orgId), eq(clients.status, 'active'), isNull(clients.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(courtCommunications)
      .where(and(eq(courtCommunications.organizationId, orgId), eq(courtCommunications.status, 'new'))),
    db.select({ n: sql<number>`count(*)::int` }).from(deadlines)
      .where(and(eq(deadlines.organizationId, orgId), eq(deadlines.status, 'overdue'))),
    db.select({ n: sql<number>`count(*)::int` }).from(deadlines)
      .where(and(
        eq(deadlines.organizationId, orgId),
        inArray(deadlines.status, ['open', 'acknowledged']),
        gte(deadlines.dueAt, todayStart),
        lt(deadlines.dueAt, nowPlus7),
      )),
    db.select({ n: sql<number>`count(*)::int` }).from(workflowTasks)
      .where(and(
        eq(workflowTasks.organizationId, orgId),
        sql`${workflowTasks.status} not in ('completed', 'cancelled')`,
      )),
    db.select({ n: sql<number>`count(*)::int` }).from(opportunities)
      .where(and(
        eq(opportunities.organizationId, orgId),
        inArray(opportunities.status, ['suggested', 'qualified', 'pursuing']),
      )),
    db.select({ n: sql<number>`count(*)::int` }).from(calendarEvents)
      .where(and(
        eq(calendarEvents.organizationId, orgId),
        gte(calendarEvents.startsAt, todayStart),
        lt(calendarEvents.startsAt, tomorrowStart),
      )),
  ])

  return c.json({
    activeCases: activeCases?.n ?? 0,
    activeClients: activeClients?.n ?? 0,
    newIntimations: newIntimations?.n ?? 0,
    overdueDeadlines: overdueDeadlines?.n ?? 0,
    weekDeadlines: weekDeadlines?.n ?? 0,
    openTasks: openTasks?.n ?? 0,
    openOpportunities: openOpportunities?.n ?? 0,
    todayEvents: todayEvents?.n ?? 0,
  })
})
