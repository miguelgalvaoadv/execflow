/**
 * pg-boss client singleton for worker processes.
 *
 * pg-boss provides:
 * - Job queue backed by PostgreSQL (same database as the application)
 * - Exactly-once delivery via row-level locks
 * - Dead-letter queue as a PostgreSQL table
 * - Configurable retry with backoff
 * - Cron-style scheduling for SLA sweeps
 * - Job deduplication via `singletonKey` (for idempotent sends)
 *
 * IMPORTANT: pg-boss creates and manages its own tables in the database
 * under the 'pgboss' schema. These are separate from EXECFLOW application
 * tables and do not require custom migrations.
 *
 * Architecture ref: technical-stack-decision.md §2.4 (queue execution model),
 *                   event-state-architecture.md §2.7 (event propagation).
 */

import { PgBoss } from 'pg-boss'

let bossInstance: PgBoss | null = null

/**
 * Creates and initializes a pg-boss instance.
 * Call once at worker process startup.
 *
 * @param connectionString - Same DATABASE_URL as the rest of the application.
 */
export async function createPgBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,

    /**
     * Maximum concurrent connections in the pg-boss internal pool.
     * Conservative: the bottleneck is database writes (audit + domain events),
     * not CPU. Increase when queue throughput requires it.
     */
    max: 10,

    /**
     * Monitoring interval for scheduled jobs (pg-boss cron).
     * 30 seconds is sufficient for SLA sweeps.
     */
    monitorIntervalSeconds: 30,
  })

  boss.on('error', (error: Error) => {
    console.error('[pg-boss] Unhandled error:', error)
  })

  await boss.start()
  bossInstance = boss

  console.info('[pg-boss] Started successfully')
  return boss
}

/**
 * Returns the pg-boss instance (must have called createPgBoss first).
 */
export function getPgBoss(): PgBoss {
  if (!bossInstance) {
    throw new Error('[pg-boss] Not initialized — call createPgBoss() first')
  }
  return bossInstance
}

/**
 * Gracefully stops pg-boss.
 * Call on process SIGTERM / SIGINT to allow in-flight jobs to complete.
 */
export async function stopPgBoss(): Promise<void> {
  if (bossInstance) {
    await bossInstance.stop({ graceful: true, timeout: 10_000 })
    bossInstance = null
    console.info('[pg-boss] Stopped gracefully')
  }
}
