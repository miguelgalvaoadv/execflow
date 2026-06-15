const pg = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const docs = await pool.query('SELECT count(*) from documents');
  console.log('Docs count:', docs.rows[0].count);
  const events = await pool.query('SELECT count(*) from timeline_events');
  console.log('Timeline events count:', events.rows[0].count);
  process.exit(0);
}
main().catch(console.error);
