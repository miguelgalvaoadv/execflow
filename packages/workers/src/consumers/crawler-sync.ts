import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import { crawlerSyncLogs, executionCases, documents, domainEvents, timelineEvents } from '@execflow/db/schema'
import { eq, and } from '@execflow/db/client'
import { QUEUE_CRAWLER_SYNC_REQUESTED } from '../queues/names.ts'
import { createJuditClient } from '../integrations/judit-client.ts'

/**
 * Payload expected by the crawler.sync.requested job.
 */
export type CrawlerSyncRequestedEvent = {
  logId: string
  organizationId: string
  executionCaseId: string
  requestedByUserId?: string
}

/**
 * Court Crawler Worker
 *
 * Se JUDIT_API_KEY estiver configurada:
 * 1. Busca o processo no datalake JUDIT pelo CNJ
 * 2. Compara as movimentações com o que já existe no ExecFlow
 * 3. Registra novas movimentações na timeline
 * 4. Emite evento de domínio para acionar avaliação do motor
 *
 * Se não estiver configurada:
 * Executa em modo simulado (mesmo comportamento antigo)
 */
export async function handleCrawlerSyncRequested(db: WorkersDb, job: Job<CrawlerSyncRequestedEvent>) {
  const { logId, organizationId, executionCaseId, requestedByUserId } = job.data

  console.log(`[Crawler Worker] Starting sync for case ${executionCaseId} (Log ID: ${logId})`)

  // 1. Mark as running
  await db
    .update(crawlerSyncLogs)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(eq(crawlerSyncLogs.id, logId), eq(crawlerSyncLogs.organizationId, organizationId)))

  try {
    // 2. Fetch case info
    const [execCase] = await db
      .select()
      .from(executionCases)
      .where(and(eq(executionCases.id, executionCaseId), eq(executionCases.organizationId, organizationId)))

    if (!execCase) throw new Error('Case not found')

    const cnj = execCase.executionProcessNumber
    if (!cnj) throw new Error('Caso sem número de processo (CNJ)')

    // 3. Tenta usar JUDIT API real
    const juditClient = createJuditClient()

    if (juditClient) {
      await syncViaJudit(db, juditClient, execCase, logId, organizationId, requestedByUserId)
    } else {
      await syncSimulated(db, execCase, logId, organizationId, requestedByUserId)
    }

    // 4. Mark sync as successful
    await db
      .update(crawlerSyncLogs)
      .set({ status: 'success', completedAt: new Date() })
      .where(eq(crawlerSyncLogs.id, logId))

    console.log(`[Crawler Worker] ✅ Sync completed for case ${executionCaseId}`)

  } catch (err: any) {
    console.error(`[Crawler Worker] ❌ Error syncing case ${executionCaseId}:`, err)

    await db
      .update(crawlerSyncLogs)
      .set({ status: 'failed', completedAt: new Date(), errorDetails: err.message })
      .where(eq(crawlerSyncLogs.id, logId))

    throw err
  }
}

/**
 * Sincronização real via JUDIT API.
 */
async function syncViaJudit(
  db: WorkersDb,
  juditClient: any,
  execCase: any,
  logId: string,
  organizationId: string,
  requestedByUserId?: string
) {
  const cnj = execCase.executionProcessNumber

  console.log(`[Crawler Worker] 🏛️ Consultando JUDIT API para CNJ: ${cnj}`)

  // Cria uma consulta assíncrona no JUDIT
  const request = await juditClient.createRequest({
    searchType: 'lawsuit_cnj',
    searchValue: cnj,
  })

  console.log(`[Crawler Worker] JUDIT request criada: ${request.id}`)

  // Aguarda o resultado (polling simples - em produção usaria webhook)
  let attempts = 0
  let result: any = null
  const maxAttempts = 30 // 30 tentativas = ~60 segundos

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    attempts++

    try {
      result = await juditClient.getRequestResult(request.id)
      if (result.status === 'completed' || result.status === 'done') {
        break
      }
    } catch (e) {
      // JUDIT pode retornar 404 enquanto processa
      if (attempts >= maxAttempts) throw e
    }
  }

  // Tenta também buscar direto do datalake (cache)
  if (!result || !result.lawsuit) {
    try {
      result = { lawsuit: await juditClient.getLawsuitByCNJ(cnj) }
    } catch (e) {
      console.warn(`[Crawler Worker] Datalake JUDIT sem cache para ${cnj}`)
    }
  }

  if (!result?.lawsuit?.steps || result.lawsuit.steps.length === 0) {
    console.log(`[Crawler Worker] Nenhuma movimentação encontrada para ${cnj}`)
    return
  }

  // Registra movimentações na timeline
  const steps = result.lawsuit.steps
  let newEventsCount = 0

  for (const step of steps) {
    // Verifica se o evento já existe (para evitar duplicatas)
    const existingEvents = await db
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.executionCaseId, execCase.id),
          eq(timelineEvents.summary, `Movimentação: ${step.type || 'Atualização'} - ${step.description}`),
          eq(timelineEvents.source, 'integration'),
        )
      )

    if (existingEvents.length > 0) continue // Já existe, pula

    await db.insert(timelineEvents).values({
      organizationId,
      executionCaseId: execCase.id,
      eventCategory: 'court',
      eventType: 'process_movement',
      occurredAt: new Date(step.date),
      summary: `Movimentação: ${step.type || 'Atualização'} - ${step.description}`,
      source: 'integration',
      actorType: 'system',
      actorId: 'judit-api',
    })

    newEventsCount++
  }

  console.log(`[Crawler Worker] 📋 ${newEventsCount} novas movimentações registradas para ${cnj}`)

  // Emite evento de domínio se houve novidades
  if (newEventsCount > 0) {
    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      eventType: 'case.movements.received',
      aggregateId: execCase.id,
      aggregateType: 'execution_case',
      correlationId: crypto.randomUUID(),
      actorType: 'system',
      actorId: requestedByUserId || 'crawler-judit',
      occurredAt: new Date(),
      recordedAt: new Date(),
      payload: {
        executionCaseId: execCase.id,
        cnj,
        newEventsCount,
        source: 'judit_api',
      },
      metadata: { source: 'crawler_judit' },
      causationId: null,
      processingStatus: 'pending',
      replayable: true,
    })
  }
}

/**
 * Sincronização simulada (modo desenvolvimento sem JUDIT API).
 */
async function syncSimulated(
  db: WorkersDb,
  execCase: any,
  logId: string,
  organizationId: string,
  requestedByUserId?: string
) {
  console.log(`[Crawler Worker] 🔧 Modo simulado — sem JUDIT_API_KEY configurada`)

  // Simula delay de crawling
  await new Promise(resolve => setTimeout(resolve, 3000))

  // Registra uma movimentação simulada na timeline
  await db.insert(timelineEvents).values({
    organizationId,
    executionCaseId: execCase.id,
    eventCategory: 'court',
    eventType: 'process_movement',
    occurredAt: new Date(),
    summary: 'Movimentação Simulada: Decisão Interlocutória - Simulação de movimentação processual. Configure JUDIT_API_KEY para dados reais.',
    source: 'integration',
    actorType: 'system',
    actorId: 'simulated',
  })

  // Emite evento de domínio
  await db.insert(domainEvents).values({
    id: crypto.randomUUID(),
    organizationId,
    eventType: 'case.movements.received',
    aggregateId: execCase.id,
    aggregateType: 'execution_case',
    correlationId: logId,
    actorType: requestedByUserId ? 'user' : 'system',
    actorId: requestedByUserId || 'crawler-simulated',
    occurredAt: new Date(),
    recordedAt: new Date(),
    payload: {
      executionCaseId: execCase.id,
      cnj: execCase.executionProcessNumber,
      newEventsCount: 1,
      source: 'simulated',
    },
    metadata: { source: 'crawler_simulated' },
    causationId: null,
    processingStatus: 'pending',
    replayable: true,
  })

  console.log(`[Crawler Worker] ✅ Sincronização simulada concluída`)
}
