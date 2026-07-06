import postgres from 'postgres';
import { readFileSync } from 'fs';
import path from 'path';

const sql = postgres(process.env.DATABASE_URL!);

async function runTriggers() {
  const sqlFile = path.resolve('migrations/post_baseline_triggers.sql');
  const sqlContent = readFileSync(sqlFile, 'utf8');
  
  console.log("Executing post_baseline_triggers.sql...");
  await sql.unsafe(sqlContent);
  console.log("Done.");

  const triggersRes = await sql`
    SELECT trigger_name, event_object_table FROM information_schema.triggers 
  `;
  console.log("Current triggers in DB:", triggersRes);

  process.exit(0);
}

runTriggers().catch(err => {
  console.error(err);
  process.exit(1);
});
