import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const docs = await pool.query('SELECT count(*) from documents');
  const events = await pool.query('SELECT count(*) from timeline_events');
  const opps = await pool.query('SELECT count(*) from opportunities');
  const dls = await pool.query('SELECT count(*) from deadlines');
  const runs = await pool.query('SELECT count(*) from engine_runs');
  const projs = await pool.query('SELECT count(*) from queue_projections');

  console.log('--- Database Audit Counts ---');
  console.log('Documents:         ', docs.rows[0].count);
  console.log('Timeline Events:   ', events.rows[0].count);
  console.log('Opportunities:     ', opps.rows[0].count);
  console.log('Deadlines:         ', dls.rows[0].count);
  console.log('Engine Runs:       ', runs.rows[0].count);
  console.log('Queue Projections: ', projs.rows[0].count);
  process.exit(0);
}

main().catch(console.error);
