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
  QUEUE_COURT_SCRAPER_REQUESTED,
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
  handleCourtScraperRequested,
} from '../consumers/court-scraper-worker.ts'
import {
  runEscalationSweep,
  runStaleTaskSweep,
} from '../sla/escalation-engine.ts'

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

  // Schedule the periodic sweeps
  await boss.schedule(QUEUE_SLA_OVERDUE_SWEEP, SLA_SWEEP_SCHEDULES.overdueSweep, {})
  await boss.schedule(QUEUE_SLA_SNOOZE_WAKE, SLA_SWEEP_SCHEDULES.snoozeWake, {})
  await boss.schedule(QUEUE_SLA_DEFER_WAKE, SLA_SWEEP_SCHEDULES.deferWake, {})
  await boss.schedule(QUEUE_SLA_ESCALATION_SWEEP, SLA_SWEEP_SCHEDULES.escalationSweep, {})
  await boss.schedule(QUEUE_SLA_STALE_TASK_SWEEP, SLA_SWEEP_SCHEDULES.staleTaskSweep, {})

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

  await boss.work(QUEUE_COURT_SCRAPER_REQUESTED, DOMAIN_EVENT_WORKER_OPTIONS, async (jobs: Job<any>[]) => {
    for (const job of jobs) {
      await handleCourtScraperRequested(db, job)
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
