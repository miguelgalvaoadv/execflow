import { createDb } from '@execflow/db/client'
import { runMvpEngine } from '@execflow/engine/src/engine-run-mvp.js'
import { randomUUID } from 'crypto'

async function main() {
  console.log('Iniciando Teste E2E MVP')
  const db = createDb(process.env.DATABASE_URL!)
  
  // Pegamos o primeiro execution_case e organization do banco só para teste!
  const res = await db.execute('SELECT id, organization_id FROM execution_cases LIMIT 1')
  
  if (res.rows.length === 0) {
    console.error('Nenhum caso encontrado no banco de dados para testar!')
    process.exit(1)
  }

  const caseId = res.rows[0].id as string
  const orgId = res.rows[0].organization_id as string
  
  console.log(`Testando com Caso: ${caseId} e Org: ${orgId}`)

  try {
    const oppIds = await runMvpEngine(db as any, caseId, orgId)
    console.log('Oportunidades geradas:', oppIds)

    // Verifica no banco
    const opps = await db.execute(`SELECT * FROM opportunities WHERE id = '${oppIds[0]}'`)
    console.log('Dados salvos:', opps.rows[0])

  } catch (err) {
    console.error('Erro no fluxo E2E:', err)
  }
  
  process.exit(0)
}

main()
