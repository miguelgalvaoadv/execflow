import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { crawlerSyncLogs, domainEvents, caseAnalysisRuns, documents } from '@execflow/db/schema'
import { analyzeAutosForCase, persistAnalysisReport } from '../services/case-analysis.ts'
import { buildAnalysisPackage } from '../services/analysis-package.ts'
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

  // Guarda contra duplo-clique / múltiplas abas: cada chamada ao Claude
  // custa ~US$0,05-1,10 dependendo do tamanho dos autos (autos grandes,
  // ~600 pág., passam de US$1). Sem essa checagem, dois cliques disparavam
  // duas análises completas e pagas em paralelo pro MESMO caso — achado
  // 08/07/2026 vasculhando ai_interaction_logs: 4 análises do mesmo caso em
  // 33 min (uma delas com só 16s de intervalo) consumiram ~US$4,27 sozinhas.
  const [existingRun] = await db
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

  if (existingRun && (existingRun.status === 'pending' || existingRun.status === 'running')) {
    return c.json({ data: existingRun }, 202)
  }

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

/**
 * GET /api/v1/cases/:caseId/analysis-package
 * Modo híbrido ChatGPT (Direção 2): monta o texto que o advogado copia e cola
 * no chatgpt.com (junto com o PDF dos autos) pra fazer a análise usando a
 * assinatura fixa dele, sem gastar a API do Claude. A resposta volta pelo
 * POST /import-analysis abaixo.
 */
crawlersRouter.get('/:caseId/analysis-package', async (c) => {
  const caseId = c.req.param('caseId')
  const { organization } = c.get('org')
  const pkg = await buildAnalysisPackage(organization.id, caseId)
  if (!pkg) return c.json({ error: { code: 'NOT_FOUND', message: 'Caso não encontrado.' } }, 404)
  return c.json({ data: pkg })
})

/** Parser tolerante: aceita objeto, ou string com/sem cercas ```json. */
function parseReportLoose(raw: unknown): any {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') throw new Error('Relatório vazio ou em formato inesperado.')
  let t = raw.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1]!.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

/**
 * POST /api/v1/cases/:caseId/import-analysis
 * Recebe o relatório (JSON) que o ChatGPT gerou e o advogado colou, e persiste
 * IGUAL a uma análise da IA (mesmo `persistAnalysisReport`): snapshot de pena,
 * oportunidades sugeridas, prazos, alertas e fatos — tudo na fila de revisão
 * normal (aba Oportunidades). Registra um case_analysis_run pra tela mostrar o
 * resultado (alertas/fatos) do mesmo jeito que uma análise da IA.
 */
crawlersRouter.post('/:caseId/import-analysis', async (c) => {
  const caseId = c.req.param('caseId')
  const { organization, domainUserId } = c.get('org')

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Corpo inválido.' } }, 400)
  }

  let parsed: any
  try {
    parsed = parseReportLoose(body?.report)
  } catch (e) {
    return c.json(
      { error: { code: 'UNPROCESSABLE', message: `Não consegui ler o relatório colado como JSON válido: ${e instanceof Error ? e.message : String(e)}` } },
      422
    )
  }
  if (!parsed || typeof parsed !== 'object' || (!parsed.pena && !parsed.oportunidades && !parsed.prazos && !parsed.alertas && !parsed.fatos)) {
    return c.json(
      { error: { code: 'UNPROCESSABLE', message: 'O relatório colado não tem nenhum campo esperado (pena/oportunidades/prazos/alertas/fatos). Confira se copiou o JSON completo.' } },
      422
    )
  }

  // Autos confirmados atuais → viram o sourceDocumentIds do snapshot (pra a
  // próxima análise incremental saber o que já foi "lido").
  const confirmedAutos = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.executionCaseId, caseId), eq(documents.status, 'confirmed')))

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
    return c.json({ error: { code: 'INTERNAL', message: 'Falha ao registrar a importação.' } }, 500)
  }

  try {
    const result = await persistAnalysisReport(organization.id, caseId, domainUserId, parsed, {
      isIncremental: false,
      sourceDocumentIds: confirmedAutos.map((d) => d.id),
      documentosLidos: confirmedAutos.length,
    })
    await db
      .update(caseAnalysisRuns)
      .set({ status: 'success', completedAt: new Date(), result })
      .where(eq(caseAnalysisRuns.id, run.id))
    return c.json({ data: { run, result } }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao importar o relatório.'
    await db
      .update(caseAnalysisRuns)
      .set({ status: 'failed', completedAt: new Date(), errorDetails: message })
      .where(eq(caseAnalysisRuns.id, run.id))
    return c.json({ error: { code: 'INTERNAL', message } }, 500)
  }
})
