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
import { syncCaseByCnj } from './case-infosimples-sync.ts'
import { runDjenSync } from './djen-sync.ts'

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
 * Court Sync Worker — dispara no cadastro do caso (ou no botão "Sincronizar
 * Tribunal"). MOTOR PRINCIPAL: InfoSimples, busca por CNJ específico
 * (`case-infosimples-sync.ts`) — decisão 07/07/2026: o Miguel cadastra os
 * casos manualmente (já sabe que é execução penal), então a busca é sempre
 * por UM processo específico, nunca varredura ampla. Jusbrasil continua como
 * extra opcional (capa/autos/webhook) só se `JUSBRASIL_API_KEY` estiver
 * configurada — hoje não está, e tudo bem, o InfoSimples já traz a
 * movimentação real.
 *
 * ATUALIZAÇÃO 12/07/2026: também força o DJEN (`runDjenSync`) na mesma
 * chamada — antes só o InfoSimples era forçado, o DJEN dependia 100% do cron
 * diário (08:00 UTC), então "Sincronizar Tribunal" não trazia intimação nova
 * na hora, só movimentação. O DJEN é org-wide (baixa o caderno do dia e
 * filtra por OAB, não dá pra pedir só 1 CNJ) — rodar aqui atualiza TODOS os
 * casos da organização de uma vez, não só o que foi clicado, e é grátis (sem
 * custo por chamada), então não há problema em rodar de novo a cada clique.
 *
 * `monitoringStatus` reflete o resultado real da busca:
 *   'monitored'      → InfoSimples achou o processo e trouxe movimentação.
 *   'sealed'         → InfoSimples NÃO achou (código 612) — pode ser CNJ
 *                       digitado errado OU segredo de justiça (as duas fontes
 *                       públicas não enxergam processo sigiloso; ver
 *                       MANUAL_DO_SISTEMA.md). Confira o número; se estiver
 *                       certo, a movimentação só vai entrar pelos autos que
 *                       você subir manualmente.
 *   'manual_review'  → falha de rede/config — tenta de novo no próximo sync.
 */
export async function handleCrawlerSyncRequested(db: WorkersDb, job: Job<any>) {
  const raw: any = job.data
  const data = (raw?.payload && raw.payload.executionCaseId ? raw.payload : raw) as CrawlerSyncRequestedEvent
  const { logId, organizationId, executionCaseId, requestedByUserId } = data

  console.log(`[Court Sync] Iniciando sync do caso ${executionCaseId} (Log ID: ${logId})`)

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

    const infoResult = await syncCaseByCnj(db, cnj)
    if (infoResult.error) {
      console.warn(`[Court Sync] InfoSimples falhou para ${cnj}: ${infoResult.error} — marcando para conferência manual.`)
      await db
        .update(executionCases)
        .set({ monitoringStatus: 'manual_review', lastSyncedAt: new Date() })
        .where(eq(executionCases.id, execCase.id))
    } else if (infoResult.notFound) {
      console.warn(`[Court Sync] InfoSimples não localizou ${cnj} — possível segredo de justiça ou CNJ incorreto.`)
      await db
        .update(executionCases)
        .set({ monitoringStatus: 'sealed', lastSyncedAt: new Date() })
        .where(eq(executionCases.id, execCase.id))
    } else if (infoResult.found) {
      console.log(`[Court Sync] InfoSimples: ${infoResult.movementsFound} movimentação(ões) para ${cnj}.`)
      await db
        .update(executionCases)
        .set({ monitoringStatus: 'monitored', lastSyncedAt: new Date() })
        .where(eq(executionCases.id, execCase.id))
    }

    // DJEN: força a busca de intimações agora (org-wide, não só deste caso).
    // Roda independente do resultado da InfoSimples acima (fontes
    // independentes — uma falhar não deve impedir a outra de tentar).
    let djenError: string | null = null
    try {
      const djenResult = await runDjenSync(db)
      djenError = djenResult.error
      if (djenResult.error) {
        console.warn(`[Court Sync] DJEN falhou durante sync forçado: ${djenResult.error}`)
      } else {
        console.log(`[Court Sync] DJEN: ${djenResult.intimacoesFound} intimação(ões) encontrada(s) na organização.`)
      }
    } catch (e) {
      djenError = e instanceof Error ? e.message : String(e)
      console.warn('[Court Sync] DJEN lançou exceção durante sync forçado:', e)
    }

    // Achado 12/07/2026: até aqui, um erro real da InfoSimples (ex.: saldo
    // esgotado, token inválido — mesma classe de falha silenciosa já vista
    // com a Anthropic 3x nesta sessão) só gerava um console.warn e o job
    // SEGUIA pro status 'success' no fim — a tela mostrava "Sincronizado"
    // verde mesmo sem ter trazido a movimentação deste caso. "Não encontrado"
    // (segredo de justiça/CNJ incorreto) continua tratado ACIMA como
    // resultado válido, não é isso que está quebrado. InfoSimples é a fonte
    // ESPECÍFICA deste caso (por CNJ) — se ela falhar de verdade, o log fica
    // vermelho na tela, mesmo que o DJEN (org-wide, tipo de dado diferente,
    // intimação) tenha ido bem. Erro do DJEN entra só como contexto extra.
    if (infoResult.error) {
      throw new Error(
        `InfoSimples falhou para ${cnj}: ${infoResult.error}` + (djenError ? ` | DJEN também falhou: ${djenError}` : '')
      )
    }

    // Jusbrasil: extra opcional, só roda se a chave estiver configurada.
    const jusbrasil = createJusbrasilClient()
    if (jusbrasil) {
      await syncViaJusbrasil(db, jusbrasil, execCase, organizationId, requestedByUserId)
    }

    if (logId) {
      await db
        .update(crawlerSyncLogs)
        .set({ status: 'success', completedAt: new Date() })
        .where(eq(crawlerSyncLogs.id, logId))
    }

    console.log(`[Court Sync] ✅ Sync concluído para ${executionCaseId}`)
  } catch (err: any) {
    console.error(`[Court Sync] ❌ Erro no caso ${executionCaseId}:`, err)
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
