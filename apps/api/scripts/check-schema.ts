import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const sql = postgres('postgresql://execflow:execflow@localhost:5432/execflow')
const db = drizzle(sql)

async function run() {
  const result = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'timeline_events'
    ORDER BY ordinal_position;
  `
  console.log(result)
  process.exit(0)
}

run()
