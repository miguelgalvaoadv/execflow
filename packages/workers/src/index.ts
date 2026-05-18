/**
 * EXECFLOW workers — entry point.
 *
 * This process:
 * 1. Connects to the database (postgres.js driver for long-running process)
 * 2. Starts pg-boss (creates/migrates pg-boss tables if needed)
 * 3. Starts the transactional outbox relay (setInterval loop)
 * 4. Registers all SLA sweep cron jobs
 * 5. Registers all domain event consumers
 * 6. Listens for SIGTERM/SIGINT for graceful shutdown
 *
 * DEPLOYMENT:
 * Run as a separate long-running process alongside apps/api.
 * Environment variables:
 *   DATABASE_URL — PostgreSQL connection string (same as apps/api)
 *
 * Architecture ref: technical-stack-decision.md §2.3 (worker architecture).
 */

import { createWorkersDb } from './lib/db.ts'
import { createPgBoss, stopPgBoss } from './bootstrap/pg-boss.ts'
import { startOutboxRelay } from './outbox/relay.ts'
import { registerAllWorkers } from './bootstrap/worker-registry.ts'

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    console.error('[workers] DATABASE_URL environment variable is required')
    process.exit(1)
  }

  console.info('[workers] Starting EXECFLOW worker process...')

  const db = createWorkersDb(databaseUrl)
  const boss = await createPgBoss(databaseUrl)

  const stopRelay = startOutboxRelay(db, boss)

  await registerAllWorkers(boss, db)

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[workers] Received ${signal}, shutting down gracefully...`)
    stopRelay()
    await stopPgBoss()
    console.info('[workers] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })

  console.info('[workers] EXECFLOW workers running')
}

main().catch((err) => {
  console.error('[workers] Fatal error:', err)
  process.exit(1)
})
