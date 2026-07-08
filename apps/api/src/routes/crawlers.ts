import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { crawlerSyncLogs, domainEvents, caseAnalysisRuns } from '@execflow/db/schema'
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
 * GET /api/v1/cases/:caseId/analysis-status
 * Retorna o status da última análise de autos (IA) para este caso.
 */
crawlersRouter.get('/:caseId/analysis-status', async (c) => {
  const caseId = c.req.param('caseId')
  const { organization } = c.get('org')

  const runs = await db
    .select()
    .from(caseAnalysisRuns)
    .where(
      and(
        eq(caseAnalysisRuns.executionCaseId, caseId),
        eq(caseAnalysisRuns.organizationId, organization.id)
      )
    )
    .orderBy(desc(caseAnalysisRuns.createdAt))
    .limit(1)

  if (runs.length === 0) {
    return c.json({ data: null })
  }

  return c.json({ data: runs[0] })
})

/**
 * POST /api/v1/cases/:caseId/analyze
 * Analisa os autos confirmados do caso com IA (Claude): gera cálculo de
 * pena (snapshot proposto), oportunidades sugeridas e prazos.
 *
 * ASSÍNCRONO (202 Accepted): a chamada ao Claude leva 60-120s+ para PDFs
 * reais — segurar a requisição HTTP até o fim atravessa o proxy do Next.js
 * (rewrites), que corta a conexão em requisições longas e devolve "Internal
 * Server Error" ao navegador mesmo quando o backend termina com sucesso
 * (achado 08/07/2026, testando o caso real do Marcelo: hit direto na API deu
 * 200, hit pelo proxy do Next deu 500). Roda em segundo plano; o front faz
 * polling em GET /analysis-status, igual ao padrão de sync-tribunal.
 */
crawlersRouter.post('/:caseId/analyze', async (c) => {
  const caseId = c.req.param('caseId')
  const { organization, domainUserId } = c.get('org')

  const [run] = await db
    .insert(caseAnalysisRuns)
    .values({
      organizationId: organization.id,
      executionCaseId: caseId,
      status: 'running',
      startedAt: new Date(),
      createdByUserId: domainUserId,
    })
    .returning()

  if (!run) {
    return c.json({ error: { code: 'INTERNAL', message: 'Failed to create analysis run.' } }, 500)
  }

  void analyzeAutosForCase(organization.id, caseId, domainUserId)
    .then(async (result) => {
      await db
        .update(caseAnalysisRuns)
        .set({ status: 'success', completedAt: new Date(), result })
        .where(eq(caseAnalysisRuns.id, run.id))
    })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : 'Falha ao analisar os autos.'
      await db
        .update(caseAnalysisRuns)
        .set({ status: 'failed', completedAt: new Date(), errorDetails: message })
        .where(eq(caseAnalysisRuns.id, run.id))
    })

  return c.json({ data: run }, 202)
})
