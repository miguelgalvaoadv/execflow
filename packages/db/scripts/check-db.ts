import postgres from 'postgres';
import { readFileSync } from 'fs';

const sql = postgres(process.env.DATABASE_URL!);

async function checkDb() {
  console.log("Checking engine_runs.is_replay type...");
  const typeRes = await sql`
    SELECT data_type FROM information_schema.columns 
    WHERE table_name = 'engine_runs' AND column_name = 'is_replay'
  `;
  console.log("is_replay type:", typeRes[0]?.data_type);

  console.log("Checking deadline_history columns...");
  const colsRes = await sql`
    SELECT column_name, is_nullable FROM information_schema.columns 
    WHERE table_name = 'deadline_history' AND column_name LIKE 'changed_by%'
  `;
  console.log("deadline_history columns:", colsRes.map(c => `${c.column_name} (${c.is_nullable})`));

  console.log("Checking triggers on deadlines table...");
  const triggersRes = await sql`
    SELECT trigger_name, action_statement FROM information_schema.triggers 
    WHERE event_object_table = 'deadlines'
  `;
  console.log("deadlines triggers:", triggersRes);

  console.log("Checking triggers on opportunities table...");
  const oppTriggersRes = await sql`
    SELECT trigger_name, action_statement FROM information_schema.triggers 
    WHERE event_object_table = 'opportunities'
  `;
  console.log("opportunities triggers:", oppTriggersRes);

  process.exit(0);
}

checkDb().catch(err => {
  console.error(err);
  process.exit(1);
});
