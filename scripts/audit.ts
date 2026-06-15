import { createDb } from '@execflow/db/client'

async function audit() {
  const db = createDb(process.env.DATABASE_URL!)
  const caseId = 'e1f45530-bed7-5e22-9ea1-386729484e44'
  
  console.log('--- 1. Documentos e OCR ---')
  const docs = await db.execute(`SELECT * FROM case_documents WHERE execution_case_id = '${caseId}' ORDER BY created_at DESC LIMIT 1`)
  console.log(docs.rows)

  console.log('\n--- 2. Snapshot ---')
  const snaps = await db.execute(`SELECT * FROM sentence_snapshots WHERE execution_case_id = '${caseId}' ORDER BY created_at DESC LIMIT 1`)
  console.log(snaps.rows)

  console.log('\n--- 3. Opportunities ---')
  const opps = await db.execute(`SELECT * FROM opportunities WHERE execution_case_id = '${caseId}' ORDER BY created_at DESC LIMIT 1`)
  console.log(opps.rows)
}

audit().catch(console.error).finally(() => process.exit(0))
