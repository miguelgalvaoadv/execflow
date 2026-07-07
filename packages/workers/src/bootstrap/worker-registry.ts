/**
 * Worker registry — registers all pg-boss workers and cron schedules.
 *
 * REGISTRATION ORDER:
 * 1. Cron jobs (SLA sweeps) — pg-boss schedules
 * 2. Domain event consumers — pg-boss workers
 *
 * Each worker registration declares:
 * - Queue name (from queues/names.ts)
 * - Worker options (from queues/config.ts)
 * - Handler function (from consumers/* or sla/*)
 *
 * IDEMPOTENCY OF REGISTRATION:
 * pg-boss is idempotent for schedule registration (duplicate schedule
 * calls update in place). Worker registrations (boss.work) are also
 * idempotent for the same queue name.
 *
 * Architecture ref: technical-stack-decision.md §2.3 (worker design requirements).
 */

import type { PgBoss } from 'pg-boss'
import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import {
  QUEUE_DEADLINE_CREATED,
  QUEUE_DEADLINE_ACKNOWLEDGED,
  QUEUE_DEADLINE_COMPLETED,
  QUEUE_DEADLINE_DISMISSED,
  QUEUE_DEADLINE_OVERDUE,
  QUEUE_OPPORTUNITY_CREATED,
  QUEUE_OPPORTUNITY_QUALIFIED,
  QUEUE_OPPORTUNITY_REVIEWED,
  QUEUE_OPPORTUNITY_DEFERRED,
  QUEUE_OPPORTUNITY_DISMISSED,
  QUEUE_INTAKE_REGISTERED,
  QUEUE_DOCUMENT_ASSOCIATED,
  QUEUE_DOCUMENT_CONFIRMED,
  QUEUE_DOCUMENT_REGISTERED,
  QUEUE_OCR_REQUESTED,
  QUEUE_OCR_COMPLETED,
  QUEUE_EXTRACTION_REQUESTED,
  QUEUE_SNAPSHOT_PROMOTION_REQUESTED,
  QUEUE_SNAPSHOT_CONFIRMED,
  QUEUE_SLA_OVERDUE_SWEEP,
  QUEUE_SLA_SNOOZE_WAKE,
  QUEUE_SLA_DEFER_WAKE,
  QUEUE_SLA_ESCALATION_SWEEP,
  QUEUE_SLA_STALE_TASK_SWEEP,
  QUEUE_TIMELINE_EVENT_APPENDED,
  QUEUE_SENTENCE_SNAPSHOT_SUPERSEDED,
  QUEUE_CUSTODY_SNAPSHOT_CREATED,
  QUEUE_ENGINE_EVALUATION_REQUESTED,
  QUEUE_ENGINE_RUN_COMPLETED,
  QUEUE_CRAWLER_SYNC_REQUESTED,
  QUEUE_WHATSAPP_NOTIFICATION_REQUESTED,
} from '../queues/names.ts'
import {
  DOMAIN_EVENT_WORKER_OPTIONS,
  SLA_SWEEP_WORKER_OPTIONS,
  SLA_SWEEP_SCHEDULES,
} from '../queues/config.ts'
import {
  handleDeadlineCreated,
  handleDeadlineAcknowledged,
  handleDeadlineCompleted,
  handleDeadlineDismissed,
  handleDeadlineOverdue,
} from '../consumers/deadline-events.ts'
import {
  handleOpportunityCreated,
  handleOpportunityQualified,
  handleOpportunityReviewed,
  handleOpportunityDeferred,
  handleOpportunityDismissed,
} from '../consumers/opportunity-events.ts'
import {
  handleIntakeRegistered,
  handleDocumentAssociated,
  handleDocumentConfirmed,
} from '../consumers/intake-events.ts'
import {
  handleSentenceSnapshotSuperseded,
  handleCustodySnapshotCreated,
  handleTimelineEventForEngine,
  handleEngineEvaluationRequested,
  handleEngineRunCompleted,
  handleSnapshotConfirmed,
} from '../consumers/engine-events.ts'
import {
  runOverdueSweep,
  runSnoozeWake,
  runDeferWake,
} from '../sla/overdue-sweep.ts'
import {
  handleDocumentRegisteredForOcr,
  handleOcrRequested,
} from '../consumers/ocr-events.ts'
import {
  handleOcrCompletedForExtraction,
  handleExtractionRequested,
} from '../consumers/extraction-events.ts'
import {
  handleDocumentConfirmedForSnapshotPromotion,
  handleSnapshotPromotionRequested,
} from '../consumers/snapshot-promotion-events.ts'
import {
  handleCrawlerSyncRequested,
} from '../consumers/crawler-sync.ts'
import {
  runEscalationSweep,
  runStaleTaskSweep,
} from '../sla/escalation-engine.ts'
import {
  handleEmailNotificationRequested,
} from '../consumers/email-notifier.ts'
import { runAstreaEmailSync } from '../consumers/astrea-email-sync.ts'
import { runSystemHealthSweep } from '../sla/system-health-sweep.ts'
import { createAstreaImapConfig } from '../integrations/astrea-imap-client.ts'
import { QUEUE_ASTREA_EMAIL_POLL, QUEUE_SYSTEM_HEALTH_SWEEP } from '../queues/names.ts'
import { ASTREA_SCHEDULES } from '../queues/config.ts'

/**
 * Validates the Astrea e-mail pipeline configuration at boot. Returns true
 * only when it's safe to register the poller — never throws, mirrors the
 * graceful-degradation pattern used by createJusbrasilClient(): if
 * misconfigured, the feature is simply disabled (logged clearly) rather
 * than crashing the whole worker process.
 */
function validateAstreaEmailConfig(): boolean {
  const config = createAstreaImapConfig()
  if (!config) {
    console.warn(
      '[worker-registry] ASTREA_IMAP_HOST/USER/PASS ausentes — pipeline de e-mail do Astrea desabilitado. Configure as variáveis para ativar.'
    )
    return false
  }

  if (process.env['ASTREA_EMAIL_POLL_ENABLED'] === 'false') {
    console.warn('[worker-registry] ASTREA_EMAIL_POLL_ENABLED=false — pipeline de e-mail do Astrea desabilitado manualmente.')
    return false
  }

  const alertEmail = process.env['ASTREA_HEALTH_ALERT_EMAIL']
  if (alertEmail && alertEmail.toLowerCase() === config.user.toLowerCase()) {
    console.error(
      '[worker-registry] ERRO DE CONFIGURAÇÃO: ASTREA_HEALTH_ALERT_EMAIL não pode ser igual a ASTREA_IMAP_USER (geraria loop de alerta dentro da própria caixa monitorada). Corrija o .env — pipeline desabilitado até lá.'
    )
    return false
  }

  return true
}

/**
 * Registers all scheduled cron jobs for SLA monitoring.
 */
async function registerSweepJobs(boss: PgBoss, db: WorkersDb): Promise<void> {
  // No need to manually create SLA sweep queues here, handled by registerAllWorkers

  // Start working on the queues
  await boss.work(QUEUE_SLA_OVERDUE_SWEEP, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runOverdueSweep(db)
  })

  await boss.work(QUEUE_SLA_SNOOZE_WAKE, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runSnoozeWake(db)
  })

  await boss.work(QUEUE_SLA_DEFER_WAKE, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runDeferWake(db)
  })

  await boss.work(QUEUE_SLA_ESCALATION_SWEEP, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runEscalationSweep(db)
  })

  await boss.work(QUEUE_SLA_STALE_TASK_SWEEP, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runStaleTaskSweep(db)
  })

  // NEW: Daily Crawler Sweep
  // Dynamic import to avoid circular dependency issues at the top level
  const { QUEUE_DAILY_CRAWLER_SWEEP } = await import('../queues/names.ts')
  const { runDailyCrawlerSweep } = await import('../consumers/daily-crawler-sweep.ts')
  
  await boss.work(QUEUE_DAILY_CRAWLER_SWEEP, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runDailyCrawlerSweep(db, boss)
  })

  // Schedule the periodic sweeps
  await boss.schedule(QUEUE_SLA_OVERDUE_SWEEP, SLA_SWEEP_SCHEDULES.overdueSweep, {})
  await boss.schedule(QUEUE_SLA_SNOOZE_WAKE, SLA_SWEEP_SCHEDULES.snoozeWake, {})
  await boss.schedule(QUEUE_SLA_DEFER_WAKE, SLA_SWEEP_SCHEDULES.deferWake, {})
  await boss.schedule(QUEUE_SLA_ESCALATION_SWEEP, SLA_SWEEP_SCHEDULES.escalationSweep, {})
  await boss.schedule(QUEUE_SLA_STALE_TASK_SWEEP, SLA_SWEEP_SCHEDULES.staleTaskSweep, {})

  // Varredura diária de movimentações (Jusbrasil) — OPT-IN (padrão desligado).
  // SEPARAÇÃO DE PAPÉIS (anti-duplicação, mesmo motivo do DataJud→caso): sem
  // JUSBRASIL_API_KEY esta varredura só marca TODO caso como 'manual_review'
  // (inclusive os que o InfoSimples/DJEN já monitoram como 'monitored'),
  // sobrescrevendo o status real todo dia às 9h UTC — bug observado em produção
  // 06/07/2026. O botão "Sincronizar" no caso continua disponível sob demanda
  // independente deste agendamento. Ligue com JUSBRASIL_CRAWLER_SWEEP_ENABLED=true.
  if (process.env['JUSBRASIL_CRAWLER_SWEEP_ENABLED'] === 'true') {
    await boss.schedule(QUEUE_DAILY_CRAWLER_SWEEP, '0 9 * * *', {})
    console.info('[worker-registry] Daily Crawler Sweep (Jusbrasil) registered (diário 09:00 UTC — OPT-IN ligado)')
  } else {
    console.info('[worker-registry] Daily Crawler Sweep (Jusbrasil) NÃO agendado (opt-in; InfoSimples/DJEN cobrem TJSP). Botão "Sincronizar" no caso segue disponível.')
  }

  // Health sweep: always registered — covers AASP webhook monitoring + stale-case sweep
  // regardless of whether Astrea email polling is enabled.
  await boss.work(QUEUE_SYSTEM_HEALTH_SWEEP, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runSystemHealthSweep(db)
  })
  await boss.schedule(QUEUE_SYSTEM_HEALTH_SWEEP, ASTREA_SCHEDULES.healthSweep, {})
  console.info('[worker-registry] System health sweep registered (diário)')

  // Inventário por OAB: enriquecimento diário via DataJud (metadados públicos).
  // 09:30 UTC ≈ 06:30 Brasília — logo após a varredura de movimentações.
  // Sem DATAJUD_API_KEY a rodada degrada graciosamente (aviso, sem crash).
  const { QUEUE_INVENTORY_ENRICHMENT, QUEUE_DATAJUD_CASE_SYNC, QUEUE_DJEN_SYNC, QUEUE_INFOSIMPLES_SYNC } = await import('../queues/names.ts')
  const { runInventoryEnrichment } = await import('../consumers/inventory-enrichment.ts')
  await boss.work(QUEUE_INVENTORY_ENRICHMENT, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runInventoryEnrichment(db)
  })
  await boss.schedule(QUEUE_INVENTORY_ENRICHMENT, '30 9 * * *', {})
  console.info('[worker-registry] Inventory DataJud enrichment registered (diário 09:30 UTC)')

  // DataJud → CASO: movimentações novas dos casos promovidos + reanálise.
  // SEPARAÇÃO DE PAPÉIS (anti-duplicação): para o TJSP, o InfoSimples já traz as
  // movimentações do caso — deixar o DataJud também escrever na timeline
  // duplicaria o mesmo fato com texto diferente (impossível deduplicar 100%).
  // Por isso o DataJud→caso fica OPT-IN (padrão desligado). O DataJud continua
  // SEMPRE ligado no enriquecimento do INVENTÁRIO (metadado, não duplica caso).
  // Ligue com DATAJUD_CASE_SYNC_ENABLED=true se usar tribunais fora do InfoSimples.
  const { runDatajudCaseSync } = await import('../consumers/datajud-case-sync.ts')
  await boss.work(QUEUE_DATAJUD_CASE_SYNC, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runDatajudCaseSync(db)
  })
  if (process.env['DATAJUD_CASE_SYNC_ENABLED'] === 'true') {
    await boss.schedule(QUEUE_DATAJUD_CASE_SYNC, '0 6,18 * * *', {})
    console.info('[worker-registry] DataJud case-sync registered (2x/dia — OPT-IN ligado)')
  } else {
    console.info('[worker-registry] DataJud case-sync NÃO agendado (opt-in; InfoSimples é a fonte de movimentação). Inventário DataJud segue ativo.')
  }

  // DJEN → intimações oficiais por OAB (grátis, sem CNPJ). 1x/dia, 08:00 UTC.
  // Via caderno diário (não mais o endpoint filtrado por OAB, bloqueado por
  // WAF anti-bot desde ~06/07/2026) — baixa o Diário do dia e filtra local,
  // então rodar 2x/dia só dobraria o download sem trazer dado novo (o
  // conteúdo de um dia já "Processado" não muda).
  const { runDjenSync } = await import('../consumers/djen-sync.ts')
  await boss.work(QUEUE_DJEN_SYNC, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runDjenSync(db)
  })
  await boss.schedule(QUEUE_DJEN_SYNC, '0 8 * * *', {})
  console.info('[worker-registry] DJEN intimações sync registered (diário 08:00 UTC, via caderno)')

  // InfoSimples → descoberta automática por OAB (TJSP e-SAJ). DESLIGADA por
  // padrão desde 07/07/2026 — decisão do Miguel: ele já tem a lista curada dos
  // processos reais do escritório e cadastra manualmente; a varredura cega da
  // OAB inteira classificava processo errado (ex.: "Ação Penal" vazou como
  // execução penal) e gastava com processo que não é do escritório. Código
  // mantido para uso manual/opt-in futuro (ex.: conferência periódica de
  // processo novo na OAB). Ligue com INFOSIMPLES_OAB_DISCOVERY_ENABLED=true.
  const { runInfosimplesSync } = await import('../consumers/infosimples-sync.ts')
  await boss.work(QUEUE_INFOSIMPLES_SYNC, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runInfosimplesSync(db)
  })
  if (process.env['INFOSIMPLES_OAB_DISCOVERY_ENABLED'] === 'true') {
    await boss.schedule(QUEUE_INFOSIMPLES_SYNC, '0 7 * * *', {})
    console.info('[worker-registry] InfoSimples OAB discovery registered (diário 07:00 UTC — OPT-IN ligado)')
  } else {
    console.info('[worker-registry] InfoSimples OAB discovery NÃO agendado (opt-in; cadastro é manual+curado pelo Miguel)')
  }

  // InfoSimples → monitoramento SÓ dos casos já cadastrados (curado). Busca por
  // CNJ específico (não a OAB inteira) — a cada 3 dias, 07:00 UTC (decisão do
  // Miguel em 07/07/2026: execução penal se move devagar, não precisa ser
  // diário — troca custo ~R$240/mês por ~R$80/mês pros 40 casos iniciais).
  // Custo: R$0,20 × nº de casos ativos com CNJ por rodada. Ver
  // case-infosimples-sync.ts para o racional completo.
  const { runCuratedInfosimplesSync } = await import('../consumers/case-infosimples-sync.ts')
  const { QUEUE_INFOSIMPLES_CURATED_SYNC } = await import('../queues/names.ts')
  await boss.work(QUEUE_INFOSIMPLES_CURATED_SYNC, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
    await runCuratedInfosimplesSync(db)
  })
  await boss.schedule(QUEUE_INFOSIMPLES_CURATED_SYNC, '0 7 */3 * *', {})
  console.info('[worker-registry] InfoSimples curated case sync registered (a cada 3 dias, 07:00 UTC — só casos cadastrados)')

  // Astrea email poll: only registered when config is valid.
  // Kill-switch: set ASTREA_EMAIL_POLL_ENABLED=false to pause without removing credentials.
  if (validateAstreaEmailConfig()) {
    await boss.work(QUEUE_ASTREA_EMAIL_POLL, SLA_SWEEP_WORKER_OPTIONS, async (_jobs: Job<unknown>[]) => {
      await runAstreaEmailSync(db)
    })
    await boss.schedule(QUEUE_ASTREA_EMAIL_POLL, ASTREA_SCHEDULES.emailPoll, {})
    console.info('[worker-registry] Astrea email pipeline registered (poll a cada 10min)')
  }

  console.info('[worker-registry] SLA sweep jobs registered')
}



/**
 * Registers all domain event consumer workers.
 */
async function registerEventConsumers(boss: PgBoss, db: WorkersDb): Promise<void> {
  // handlers do runtime narrowing on job.data — Job<any> bridges the generic gap
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await boss.work(QUEUE_DEADLINE_CREATED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleDeadlineCreated(db, job)
    }
  })

  await boss.work(QUEUE_DEADLINE_ACKNOWLEDGED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleDeadlineAcknowledged(db, job)
    }
  })

  await boss.work(QUEUE_DEADLINE_COMPLETED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleDeadlineCompleted(db, job)
    }
  })

  await boss.work(QUEUE_DEADLINE_DISMISSED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleDeadlineDismissed(db, job)
    }
  })

  await boss.work(QUEUE_DEADLINE_OVERDUE, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleDeadlineOverdue(db, job)
    }
  })

  await boss.work(QUEUE_OPPORTUNITY_CREATED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleOpportunityCreated(db, job)
    }
  })

  await boss.work(QUEUE_OPPORTUNITY_QUALIFIED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleOpportunityQualified(db, job)
    }
  })

  await boss.work(QUEUE_OPPORTUNITY_REVIEWED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleOpportunityReviewed(db, job)
    }
  })

  await boss.work(QUEUE_OPPORTUNITY_DEFERRED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleOpportunityDeferred(db, job)
    }
  })

  await boss.work(QUEUE_OPPORTUNITY_DISMISSED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleOpportunityDismissed(db, job)
    }
  })

  await boss.work(QUEUE_INTAKE_REGISTERED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleIntakeRegistered(db, job)
    }
  })

  await boss.work(QUEUE_DOCUMENT_ASSOCIATED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleDocumentAssociated(db, job)
    }
  })

  await boss.work(QUEUE_DOCUMENT_CONFIRMED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleDocumentConfirmed(db, job)
      await handleDocumentConfirmedForSnapshotPromotion(db, job)
    }
  })

  await boss.work(QUEUE_DOCUMENT_REGISTERED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleDocumentRegisteredForOcr(db, job)
    }
  })

  await boss.work(QUEUE_OCR_REQUESTED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleOcrRequested(db, job)
    }
  })

  await boss.work(QUEUE_OCR_COMPLETED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleOcrCompletedForExtraction(db, job)
    }
  })

  await boss.work(QUEUE_EXTRACTION_REQUESTED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleExtractionRequested(db, job)
    }
  })

  await boss.work(QUEUE_SNAPSHOT_PROMOTION_REQUESTED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleSnapshotPromotionRequested(db, job)
    }
  })

  await boss.work(QUEUE_SNAPSHOT_CONFIRMED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleSnapshotConfirmed(db, job)
    }
  })

  // Engine event consumers (Phase 7)
  await boss.work(QUEUE_TIMELINE_EVENT_APPENDED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleTimelineEventForEngine(db, job)
    }
  })

  await boss.work(QUEUE_SENTENCE_SNAPSHOT_SUPERSEDED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleSentenceSnapshotSuperseded(db, job)
    }
  })

  await boss.work(QUEUE_CUSTODY_SNAPSHOT_CREATED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleCustodySnapshotCreated(db, job)
    }
  })

  await boss.work(QUEUE_ENGINE_EVALUATION_REQUESTED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleEngineEvaluationRequested(db, job)
    }
  })

  await boss.work(QUEUE_ENGINE_RUN_COMPLETED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleEngineRunCompleted(db, job)
    }
  })

  await boss.work(QUEUE_CRAWLER_SYNC_REQUESTED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleCrawlerSyncRequested(db, job)
    }
  })

  await boss.work(QUEUE_WHATSAPP_NOTIFICATION_REQUESTED, async (jobs) => {
    for (const job of jobs) {
      // Fila histórica mantida por retrocompatibilidade; hoje notificamos por e-mail.
      await handleEmailNotificationRequested(db, job as any)
    }
  })

  /* eslint-enable @typescript-eslint/no-explicit-any */

  console.info('[worker-registry] Event consumers registered (including Phase 7 engine consumers)')
}

/**
 * Registers all workers with pg-boss.
 * Call once after pg-boss is started.
 */
export async function registerAllWorkers(
  boss: PgBoss,
  db: WorkersDb
): Promise<void> {
  // 1. Criar TODAS as queues preventivamente para evitar erros "Queue ... does not exist"
  const queueNamesModule = await import('../queues/names.ts')
  for (const [, queueName] of Object.entries(queueNamesModule)) {
    if (typeof queueName === 'string') {
      try {
        await boss.createQueue(queueName)
      } catch (err) {
        // Ignorar se já existe ou outro erro minor
        console.warn(`[worker-registry] Warning creating queue ${queueName}:`, err)
      }
    }
  }

  await registerSweepJobs(boss, db)
  await registerEventConsumers(boss, db)
  console.info('[worker-registry] All workers registered')
}
