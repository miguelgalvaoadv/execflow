import { db } from './src/client/index';
import { sql } from 'drizzle-orm';

async function main() {
  const tables = [
    'queue_projections',
    'timeline_events',
    'documents',
    'opportunities',
    'deadlines',
    'engine_runs'
  ];

  console.log("---- Table Counts ----");
  for (const t of tables) {
    try {
      const res = await db.execute(sql.raw(`SELECT COUNT(*) FROM ${t}`));
      console.log(`${t}: ${res[0].count}`);
    } catch (e) {
      console.log(`${t}: error - ${e.message}`);
    }
  }
  process.exit(0);
}

main().catch(console.error);
