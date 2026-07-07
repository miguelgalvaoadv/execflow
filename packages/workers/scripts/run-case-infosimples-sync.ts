/**
 * Execução manual: busca UM processo específico por CNJ na InfoSimples e
 * empurra a movimentação pela cadeia de reanálise (mesmo caminho do cadastro
 * de caso / botão "Sincronizar Tribunal").
 * Uso: pnpm --filter @execflow/workers exec tsx --env-file=.env.local scripts/run-case-infosimples-sync.ts <CNJ>
 * ATENÇÃO: consome crédito InfoSimples (R$0,20/página da OAB até achar o CNJ).
 */
import { createWorkersDb } from '../src/lib/db.ts'
import { syncCaseByCnj } from '../src/consumers/case-infosimples-sync.ts'

const cnj = process.argv[2]
if (!cnj) {
  console.error('Uso: tsx scripts/run-case-infosimples-sync.ts <CNJ>')
  process.exit(1)
}
const cs = process.env['DATABASE_URL']
if (!cs) { console.error('DATABASE_URL ausente'); process.exit(1) }
const result = await syncCaseByCnj(createWorkersDb(cs), cnj)
console.log('\nResultado:', JSON.stringify(result, null, 2))
process.exit(result.error ? 1 : 0)
