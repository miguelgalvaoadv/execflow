import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import { crawlerSyncLogs, executionCases, timelineEvents } from '@execflow/db/schema'
import { eq, and } from '@execflow/db/client'
import {
  createJusbrasilClient,
  extractProcessSummary,
  extractMovements,
  type JusbrasilClient,
} from '../integrations/jusbrasil-client.ts'
import { hasAutosDocument, ingestAutosFromLinks } from '../integrations/autos-ingestion.ts'
import { upsertTimelineEvent, emitMovementsReceived } from '../integrations/timeline-sync-helpers.ts'

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
 * Court Sync Worker — motor ÚNICO: JUSBRASIL.
 *
 * Ao cadastrar um caso (ou no "Sincronizar Tribunal" / varredura diária), este
 * worker:
 *   1. Consulta a capa do processo (tribunal, classe, partes) no Jusbrasil;
 *   2. Importa as movimentações para a timeline;
 *   3. Baixa os autos em PDF quando há links disponíveis na resposta;
 *   4. Cria o monitoramento contínuo apontando o callback para
 *      /api/v1/webhooks/jusbrasil (atualizações em tempo real).
 *
 * Sem JUSBRASIL_API_KEY o caso é marcado como 'manual_review' (nada de dados
 * falsos) — basta configurar a chave para os dados reais entrarem.
 */
export async function handleCrawlerSyncRequested(db: WorkersDb, job: Job<any>) {
  const raw: any = job.data
  const data = (raw?.payload && raw.payload.executionCaseId ? raw.payload : raw) as CrawlerSyncRequestedEvent
  const { logId, organizationId, executionCaseId, requestedByUserId } = data

  console.log(`[Jusbrasil Sync] Iniciando sync do caso ${executionCaseId} (Log ID: ${logId})`)

  if (logId) {
    await db
      .update(crawlerSyncLogs)
      .set({ status: 'running', startedAt: new Date() })
      .where(and(eq(crawlerSyncLogs.id, logId), eq(crawlerSyncLogs.organizationId, organizationId)))
  }

  try {
    const [execCase] = await db
      .select()
      .from(executionCases)
      .where(and(eq(executionCases.id, executionCaseId), eq(executionCases.organizationId, organizationId)))

    if (!execCase) throw new Error('Caso não encontrado')

    const cnj = execCase.executionProcessNumber
    if (!cnj) throw new Error('Caso sem número de processo (CNJ)')

    const jusbrasil = createJusbrasilClient()

    if (!jusbrasil) {
      console.warn('[Jusbrasil Sync] JUSBRASIL_API_KEY ausente — marcando caso para conferência manual.')
      await db
        .update(executionCases)
        .set({ monitoringStatus: 'manual_review', lastSyncedAt: new Date() })
        .where(eq(executionCases.id, execCase.id))
    } else {
      await syncViaJusbrasil(db, jusbrasil, execCase, organizationId, requestedByUserId)
    }

    if (logId) {
      await db
        .update(crawlerSyncLogs)
        .set({ status: 'success', completedAt: new Date() })
        .where(eq(crawlerSyncLogs.id, logId))
    }

    console.log(`[Jusbrasil Sync] ✅ Sync concluído para ${executionCaseId}`)
  } catch (err: any) {
    console.error(`[Jusbrasil Sync] ❌ Erro no caso ${executionCaseId}:`, err)
    if (logId) {
      await db
        .update(crawlerSyncLogs)
        .set({ status: 'failed', completedAt: new Date(), errorDetails: err.message })
        .where(eq(crawlerSyncLogs.id, logId))
    }
    throw err
  }
}

/**
 * Sincronização real via JUSBRASIL: capa + partes + movimentações + autos + monitoramento.
 */
async function syncViaJusbrasil(
  db: WorkersDb,
  jusbrasil: JusbrasilClient,
  execCase: typeof executionCases.$inferSelect,
  organizationId: string,
  requestedByUserId?: string
) {
  const cnj = execCase.executionProcessNumber!
  console.log(`[Jusbrasil Sync] 🏛️ Consultando CNJ: ${cnj}`)

  // 1. CAPA + PARTES — consulta o processo e registra os dados de capa.
  let segredoJustica: boolean | null = null
  let autosLinks: string[] = []
  try {
    const { data: processData } = await jusbrasil.getProcessByCnj(cnj)
    const summary = extractProcessSummary(processData)
    segredoJustica = summary.segredoJustica
    autosLinks = summary.autosLinks

    const patch: Partial<typeof executionCases.$inferInsert> = {}
    if (!execCase.courtName && summary.tribunal) patch.courtName = summary.tribunal
    if (Object.keys(patch).length > 0) {
      await db.update(executionCases).set(patch).where(eq(executionCases.id, execCase.id))
    }

    if (summary.poloAtivo || summary.poloPassivo || summary.classe) {
      await upsertTimelineEvent(db, organizationId, execCase.id, {
        eventCategory: 'court',
        eventType: 'court.capa',
        occurredAt: new Date(),
        summary: `Capa: ${summary.classe ?? 'processo'} — ${summary.poloAtivo ?? '—'} x ${summary.poloPassivo ?? '—'}`.substring(0, 255),
        actorId: 'jusbrasil-api',
      })
    }
  } catch (e) {
    console.warn(`[Jusbrasil Sync] Falha ao consultar capa de ${cnj}:`, e)
  }

  // 2. MOVIMENTAÇÕES
  let movements: Array<{ data?: string; tipo?: string; descricao?: string; conteudo?: string; complemento?: string }> = []
  try {
    const { data } = await jusbrasil.getProcessMovements(cnj)
    movements = extractMovements(data)
  } catch (e) {
    console.warn(`[Jusbrasil Sync] Sem movimentações disponíveis para ${cnj}:`, e)
  }

  let newEventsCount = 0
  for (const mov of movements) {
    const desc = mov.descricao || mov.complemento || mov.conteudo || mov.tipo || 'Atualização'
    const summary = `Movimentação: ${mov.tipo || 'Andamento'} - ${desc}`.substring(0, 255)
    const created = await upsertTimelineEvent(db, organizationId, execCase.id, {
      eventCategory: 'court',
      eventType: 'process_movement',
      occurredAt: mov.data ? new Date(mov.data) : new Date(),
      summary,
      actorId: 'jusbrasil-api',
    })
    if (created) newEventsCount++
  }
  console.log(`[Jusbrasil Sync] 📋 ${newEventsCount} novas movimentações para ${cnj}`)

  // 3. STATUS DE MONITORAMENTO
  await db
    .update(executionCases)
    .set({ monitoringStatus: segredoJustica ? 'sealed' : 'monitored', lastSyncedAt: new Date() })
    .where(eq(executionCases.id, execCase.id))

  if (newEventsCount > 0) {
    await emitMovementsReceived(db, execCase, organizationId, newEventsCount, 'jusbrasil_api', requestedByUserId)
  }

  // 4. AUTOS — baixa PDFs se a resposta trouxer links.
  if (autosLinks.length > 0 && !(await hasAutosDocument(db, organizationId, execCase.id))) {
    try {
      const ids = await ingestAutosFromLinks({
        db,
        jusbrasil,
        organizationId,
        executionCaseId: execCase.id,
        clientId: execCase.clientId,
        cnj,
        uploadedByUserId: requestedByUserId ?? 'system',
        autosLinks,
      })
      if (ids.length > 0) {
        await upsertTimelineEvent(db, organizationId, execCase.id, {
          eventCategory: 'court',
          eventType: 'autos_requested',
          occurredAt: new Date(),
          summary: `Autos baixados do Jusbrasil (${ids.length} documento(s) ingerido(s)).`,
          actorId: 'jusbrasil-api',
        })
      }
    } catch (e) {
      console.warn(`[Jusbrasil Sync] Não foi possível ingerir autos para ${cnj}:`, e)
    }
  }

  // 5. MONITORAMENTO contínuo (callback em tempo real), uma única vez por caso.
  await ensureMonitoring(db, jusbrasil, execCase, organizationId, cnj)
}

/**
 * Cria o monitoramento contínuo no Jusbrasil (uma vez por caso).
 * Idempotente via marcador na timeline.
 */
async function ensureMonitoring(
  db: WorkersDb,
  jusbrasil: JusbrasilClient,
  execCase: typeof executionCases.$inferSelect,
  organizationId: string,
  cnj: string
) {
  const already = await db
    .select({ id: timelineEvents.id })
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.executionCaseId, execCase.id),
        eq(timelineEvents.eventType, 'monitoring.created')
      )
    )
    .limit(1)
  if (already.length > 0) return

  const callbackUrl =
    process.env['JUSBRASIL_WEBHOOK_URL'] ||
    (process.env['PUBLIC_API_URL']
      ? `${process.env['PUBLIC_API_URL'].replace(/\/$/, '')}/api/v1/webhooks/jusbrasil`
      : undefined)

  try {
    const mon = await jusbrasil.createMonitoring(cnj, callbackUrl)
    await db.insert(timelineEvents).values({
      organizationId,
      executionCaseId: execCase.id,
      eventCategory: 'system',
      eventType: 'monitoring.created',
      occurredAt: new Date(),
      summary: `Monitoramento contínuo ativado no Jusbrasil (#${mon.id}). Atualizações chegam em tempo real.`,
      source: 'integration',
      actorType: 'system',
      actorId: 'jusbrasil-api',
    })
    console.log(`[Jusbrasil Sync] 🔔 Monitoramento #${mon.id} criado para ${cnj} (callback: ${callbackUrl ?? 'painel'})`)
  } catch (e) {
    console.warn(`[Jusbrasil Sync] Não foi possível criar monitoramento para ${cnj}:`, e)
  }
}
