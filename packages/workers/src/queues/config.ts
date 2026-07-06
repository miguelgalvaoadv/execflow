/**
 * pg-boss queue configuration and retry strategies.
 *
 * RETRY DESIGN:
 * Domain event consumers must be idempotent — processing the same event
 * twice produces the same result. This makes retries safe.
 *
 * However, retries must be bounded and DLQ-capable for legal safety:
 * - A permanently failing consumer must alert admin (not silently drop).
 * - DLQ items are retained for human inspection and manual replay.
 *
 * RETRY SCHEDULES:
 * - Domain events: 3 retries with exponential backoff (5s, 25s, 125s)
 * - SLA sweeps: no retry needed (next cron execution handles any gap)
 * - Outbox relay: 5 retries, short backoff (relay must be fast)
 *
 * Architecture ref: event-state-architecture.md §2.11 (failure tolerance).
 */

import type { WorkOptions, SendOptions } from 'pg-boss'

/**
 * Default options for domain event consumer workers.
 * Applied when registering consumers with boss.work().
 */
export const DOMAIN_EVENT_WORKER_OPTIONS: WorkOptions = {
  localConcurrency: 5,
  batchSize: 1,
}

/**
 * Default options for sending domain event jobs.
 * Applied by the outbox relay when publishing events.
 */
export const DOMAIN_EVENT_SEND_OPTIONS: SendOptions = {
  retryLimit: 3,
  retryDelay: 5,
  retryBackoff: true,
}

/**
 * Options for SLA sweep cron jobs.
 * These are short-lived; no retry needed (next cron run handles the gap).
 */
export const SLA_SWEEP_WORKER_OPTIONS: WorkOptions = {
  localConcurrency: 1,
  batchSize: 1,
}

/**
 * Cron schedules for SLA sweep jobs (UTC cron syntax).
 */
export const SLA_SWEEP_SCHEDULES = {
  /** Overdue sweep: check for deadlines past due_at every 5 minutes */
  overdueSweep: '*/5 * * * *',
  /** Snooze wake: check for snoozed items every 2 minutes */
  snoozeWake: '*/2 * * * *',
  /** Defer wake: check for deferred items every 2 minutes */
  deferWake: '*/2 * * * *',
  /** Escalation sweep: evaluate SLA breaches every 10 minutes */
  escalationSweep: '*/10 * * * *',
  /** Stale task sweep: find tasks with no activity every 30 minutes */
  staleTaskSweep: '*/30 * * * *',
} as const

/**
 * Cron schedules for the Astrea e-mail ingestion pipeline.
 */
export const ASTREA_SCHEDULES = {
  /** IMAP poll: read unread e-mails every 10 minutes (Astrea's own update lag is ~12h, so this is for same-day detection, not real-time). */
  emailPoll: '*/10 * * * *',
  /** Health sweep: verify the pipeline once a day, mid-morning Brasília time. */
  healthSweep: '0 12 * * *',
} as const
