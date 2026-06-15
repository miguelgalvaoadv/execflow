import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

async function main() {
  const connection = postgres(process.env.DATABASE_URL!);
  const db = drizzle(connection);
  
  await db.execute(sql`
    TRUNCATE TABLE organizations CASCADE;
    TRUNCATE TABLE users CASCADE;
    TRUNCATE TABLE ba_user CASCADE;
  `);
  
  console.log('Database truncated!');
  process.exit(0);
}

main().catch(console.error);
