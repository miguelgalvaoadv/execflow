/**
 * Execução manual do sync InfoSimples (descoberta+cadastro por OAB).
 * Uso: pnpm --filter @execflow/workers exec tsx --env-file=.env.local scripts/run-infosimples-sync.ts
 * ATENÇÃO: consome créditos InfoSimples (R$0,20/página).
 */
import { createWorkersDb } from '../src/lib/db.ts'
import { runInfosimplesSync } from '../src/consumers/infosimples-sync.ts'

const cs = process.env['DATABASE_URL']
if (!cs) { console.error('DATABASE_URL ausente'); process.exit(1) }
const result = await runInfosimplesSync(createWorkersDb(cs))
console.log('\nResultado:', JSON.stringify(result, null, 2))
process.exit(result.error ? 1 : 0)
