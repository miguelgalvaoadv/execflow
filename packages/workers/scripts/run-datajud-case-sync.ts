/**
 * Execução manual do sync DataJud → caso (movimentações + reanálise).
 * Uso: pnpm --filter @execflow/workers exec tsx --env-file=.env.local scripts/run-datajud-case-sync.ts
 */
import { createWorkersDb } from '../src/lib/db.ts'
import { runDatajudCaseSync } from '../src/consumers/datajud-case-sync.ts'

const cs = process.env['DATABASE_URL']
if (!cs) { console.error('DATABASE_URL ausente'); process.exit(1) }
const result = await runDatajudCaseSync(createWorkersDb(cs))
console.log('\nResultado:', JSON.stringify(result, null, 2))
process.exit(result.error ? 1 : 0)
