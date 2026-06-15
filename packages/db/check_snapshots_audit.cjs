const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://execflow:execflow@localhost:5432/execflow' });
async function run() {
  await client.connect();
  
  const snaps = await client.query('select count(*), status from sentence_snapshots group by status');
  console.log('--- SENTENCE SNAPSHOTS ---');
  console.log(snaps.rows);
  
  const evts = await client.query("select count(*) from domain_events where event_type = 'snapshot.confirmed'");
  console.log('--- DOMAIN EVENTS snapshot.confirmed ---');
  console.log(evts.rows[0].count);
  
  const recals = await client.query('select count(*) from recalculation_runs');
  console.log('--- RECALCULATION RUNS ---');
  console.log(recals.rows[0].count);
  
  const cases = await client.query('select id, internal_ref from execution_cases limit 5');
  console.log('--- CASES SAMPLE ---');
  console.log(cases.rows);
  
  const audits = await client.query("select count(*) from audit_logs where action like '%snapshot%' or action like '%calculation%'");
  console.log('--- AUDIT LOGS FOR SNAPSHOTS ---');
  console.log(audits.rows[0].count);

  await client.end();
}
run().catch(console.error);
