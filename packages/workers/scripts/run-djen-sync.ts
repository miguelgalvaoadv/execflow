/**
 * Execução manual do sync DJEN (intimações por OAB).
 * Uso: pnpm --filter @execflow/workers exec tsx --env-file=.env.local scripts/run-djen-sync.ts
 */
import { createWorkersDb } from '../src/lib/db.ts'
import { runDjenSync } from '../src/consumers/djen-sync.ts'

const cs = process.env['DATABASE_URL']
if (!cs) { console.error('DATABASE_URL ausente'); process.exit(1) }
const result = await runDjenSync(createWorkersDb(cs))
console.log('\nResultado:', JSON.stringify(result, null, 2))
process.exit(result.error ? 1 : 0)
