import { db } from './src/client/index';
import { sql } from 'drizzle-orm';

async function main() {
  console.log("Truncating playbook_families...");
  try {
    await db.execute(sql.raw(`TRUNCATE TABLE playbook_families CASCADE`));
    console.log("playbook_families truncated successfully.");
  } catch (e) {
    console.error("Error truncating:", e);
  }
  process.exit(0);
}

main().catch(console.error);
