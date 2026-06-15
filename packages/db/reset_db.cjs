const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://execflow:execflow@localhost:5432/execflow' });

async function main() {
  console.log("Dropping and recreating public schema...");
  try {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO public');
    console.log("Database schema reset successfully.");
  } catch (e) {
    console.error("Error resetting schema:", e);
  }
  process.exit(0);
}

main().catch(console.error);
