/**
 * Execução manual do enriquecimento DataJud do inventário.
 *
 * Uso: pnpm --filter @execflow/workers exec tsx --env-file=.env.local scripts/run-inventory-enrichment.ts
 *
 * O mesmo código roda no cron diário (09:30 UTC). Este script existe para a
 * primeira carga e para diagnóstico sem esperar o agendamento.
 */

import { createWorkersDb } from '../src/lib/db.ts'
import { runInventoryEnrichment } from '../src/consumers/inventory-enrichment.ts'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) {
  console.error('DATABASE_URL ausente no .env.local')
  process.exit(1)
}
const db = createWorkersDb(connectionString)
const result = await runInventoryEnrichment(db)
console.log('\nResultado:', JSON.stringify(result, null, 2))
process.exit(result.error ? 1 : 0)
