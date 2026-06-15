const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://execflow:execflow@localhost:5432/execflow' });

async function main() {
  console.log("Truncating playbook_families...");
  try {
    await pool.query('TRUNCATE TABLE playbook_families CASCADE');
    console.log("playbook_families truncated successfully.");
  } catch (e) {
    console.error("Error truncating:", e);
  }
  process.exit(0);
}

main().catch(console.error);
