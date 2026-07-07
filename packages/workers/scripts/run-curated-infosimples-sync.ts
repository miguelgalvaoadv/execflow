/**
 * Execução manual: passa por TODOS os casos ativos já cadastrados e atualiza
 * a movimentação de cada um via InfoSimples (nunca descobre caso novo).
 * Uso: pnpm --filter @execflow/workers exec tsx --env-file=.env.local scripts/run-curated-infosimples-sync.ts
 * ATENÇÃO: consome crédito InfoSimples (R$0,20 × nº de casos ativos com CNJ).
 */
import { createWorkersDb } from '../src/lib/db.ts'
import { runCuratedInfosimplesSync } from '../src/consumers/case-infosimples-sync.ts'

const cs = process.env['DATABASE_URL']
if (!cs) { console.error('DATABASE_URL ausente'); process.exit(1) }
const result = await runCuratedInfosimplesSync(createWorkersDb(cs))
console.log('\nResultado:', JSON.stringify(result, null, 2))
process.exit(result.error ? 1 : 0)
