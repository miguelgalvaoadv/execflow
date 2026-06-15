import fs from 'fs';
import path from 'path';
import pg from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envFileContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envFileContent.split('\n')) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      // Remove surrounding quotes if any
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      } else if (val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set in environment or .env.local');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
});

async function main() {
  console.log('Connecting to database...');
  await client.connect();
  console.log('Connected to database successfully!');

  console.log('Resetting schema to blank slate...');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  console.log('Schema reset completed.');

  // Create drizzle migrations table if it doesn't exist to make drizzle-kit think they ran
  await client.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migrations to apply.`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    console.log(`Applying migration: ${file}...`);
    const sql = fs.readFileSync(filePath, 'utf8');

    // Run the migration SQL in a transaction
    await client.query('BEGIN');
    try {
      // Execute the entire SQL script
      await client.query(sql);
      
      // Insert into drizzle migrations table to keep it in sync
      const hash = file; // Simple dummy hash or filename
      await client.query(
        'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
        [hash, Date.now()]
      );

      await client.query('COMMIT');
      console.log(`✓ Migration ${file} applied successfully.`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ Error applying migration ${file}:`, err);
      process.exit(1);
    }
  }

  console.log('All migrations applied successfully!');
  await client.end();
}

main().catch(err => {
  console.error('Unhandled error in migrations:', err);
  process.exit(1);
});
