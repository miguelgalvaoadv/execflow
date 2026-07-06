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

  // RESILIÊNCIA A OSCILAÇÃO DE REDE (03/07/2026): uma queda momentânea da
  // conexão com o Supabase emitia 'error' num Client interno do pg fora do
  // alcance dos handlers de pool/boss e DERRUBAVA o processo inteiro
  // ("Connection terminated unexpectedly"). Erros de conexão são transitórios —
  // pg-boss e o pool reconectam sozinhos; logamos e seguimos. Qualquer outro
  // erro continua fail-fast (exit 1) para não mascarar bugs.
  const isTransientDbError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err)
    return /Connection terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|Client has encountered a connection error/i.test(msg)
  }
  process.on('uncaughtException', (err) => {
    if (isTransientDbError(err)) {
      console.error('[workers] Erro transitório de conexão (processo segue; reconexão automática):', err.message)
      return
    }
    console.error('[workers] Uncaught exception (fatal):', err)
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    if (isTransientDbError(reason)) {
      console.error('[workers] Rejeição transitória de conexão (processo segue):', reason instanceof Error ? reason.message : reason)
      return
    }
    console.error('[workers] Unhandled rejection (fatal):', reason)
    process.exit(1)
  })

  console.info('[workers] EXECFLOW workers running')
}

main().catch((err) => {
  console.error('[workers] Fatal error:', err)
  process.exit(1)
})
