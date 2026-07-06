import type { Job, PgBoss } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import { executionCases, crawlerSyncLogs } from '@execflow/db/schema'
import { eq, or } from 'drizzle-orm'
import { QUEUE_CRAWLER_SYNC_REQUESTED } from '../queues/names.ts'
import { randomUUID } from 'crypto'

export async function runDailyCrawlerSweep(db: WorkersDb, boss: PgBoss) {
  console.log('[Daily Crawler Sweep] Started.')

  // Fetch all active execution cases that need monitoring
  // (In a real app, you'd filter by status != 'closed')
  const cases = await db.select().from(executionCases)

  let queuedCount = 0

  for (const execCase of cases) {
    if (!execCase.executionProcessNumber) continue

    const logId = randomUUID()

    // 1. Create a sync log
    await db.insert(crawlerSyncLogs).values({
      id: logId,
      organizationId: execCase.organizationId,
      executionCaseId: execCase.id,
      tribunalName: 'SEEU',
      status: 'pending',
    })

    // 2. Queue the sync job
    await boss.send(QUEUE_CRAWLER_SYNC_REQUESTED, {
      logId,
      organizationId: execCase.organizationId,
      executionCaseId: execCase.id,
      requestedByUserId: 'system-daily-sweep',
    }, {
      // Small jitter so we don't bombard the court exactly at midnight
      startAfter: Math.floor(Math.random() * 60) * 60, // random minute within the first hour
    })

    queuedCount++
  }

  console.log(`[Daily Crawler Sweep] Queued ${queuedCount} case syncs.`)
}
