import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { crawlerSyncLogs, domainEvents } from '@execflow/db/schema'
import { analyzeAutosForCase } from '../services/case-analysis.ts'
import type { HonoVariables } from '../context/types.ts'

/**
 * Crawler Routes
 * Mounted at /api/v1/cases
 */
export const crawlersRouter = new Hono<{ Variables: HonoVariables }>()

// Piso de role: sync/análise são ações internas do escritório — nunca 'client'.
crawlersRouter.use('*', authMiddleware, orgMiddleware, requireMinRole('assistant'))

/**
 * GET /api/v1/cases/:caseId/sync-status
 * Retorna o status da última sincronização do tribunal para este caso.
 */
crawlersRouter.get('/:caseId/sync-status', async (c) => {
  const caseId = c.req.param('caseId')
  const { organization } = c.get('org')

  const logs = await db
    .select()
    .from(crawlerSyncLogs)
    .where(
      and(
        eq(crawlerSyncLogs.executionCaseId, caseId),
        eq(crawlerSyncLogs.organizationId, organization.id)
      )
    )
    .orderBy(desc(crawlerSyncLogs.createdAt))
    .limit(1)

  if (logs.length === 0) {
    return c.json({ data: null })
  }

  return c.json({ data: logs[0] })
})

/**
 * POST /api/v1/cases/:caseId/sync-tribunal
 * Dispara o worker do Crawler para atualizar o caso.
 */
crawlersRouter.post('/:caseId/sync-tribunal', async (c) => {
  const caseId = c.req.param('caseId')
  const { organization, domainUserId } = c.get('org')

  // 1. Criar o log no banco
  const [log] = await db
    .insert(crawlerSyncLogs)
    .values({
      organizationId: organization.id,
      executionCaseId: caseId,
      status: 'pending',
      tribunalName: 'TJSP / SEEU', // Simulated
      createdByUserId: domainUserId,
    })
    .returning()

  if (!log) {
    return c.json({ error: { code: 'INTERNAL', message: 'Failed to create sync log.' } }, 500)
  }

  // 2. Enviar para a Fila do Crawler (Pg-boss via Outbox)
  await db.insert(domainEvents).values({
    id: crypto.randomUUID(),
    organizationId: organization.id,
    eventType: 'crawler.sync.requested',
    aggregateId: log.id,
    aggregateType: 'CrawlerSyncLog',
    actorType: 'user',
    actorId: domainUserId,
    occurredAt: new Date(),
    recordedAt: new Date(),
    payload: {
      logId: log.id,
      organizationId: organization.id,
      executionCaseId: caseId,
      requestedByUserId: domainUserId,
    },
    metadata: { source: 'api_crawler' },
    correlationId: log.id,
    causationId: null,
    processingStatus: 'pending',
    replayable: true,
  })

  return c.json({ data: log }, 202) // 202 Accepted
})

/**
 * POST /api/v1/cases/:caseId/analyze
 * Analisa os autos confirmados do caso com IA (Claude) e grava o cálculo de
 * pena (snapshot proposto), oportunidades sugeridas e prazos. Síncrono.
 */
crawlersRouter.post('/:caseId/analyze', async (c) => {
  const caseId = c.req.param('caseId')
  const { organization, domainUserId } = c.get('org')

  try {
    const result = await analyzeAutosForCase(organization.id, caseId, domainUserId)
    return c.json({ data: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao analisar os autos.'
    return c.json({ error: { code: 'ANALYSIS_FAILED', message } }, 400)
  }
})
