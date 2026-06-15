import { hashPassword } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { authAccounts } from '../src/schema/auth-account.ts';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const db = drizzle(sql);
  const newHash = await hashPassword('ExecflowDevSmoke123!');
  await db.update(authAccounts).set({ password: newHash });
  console.log('Passwords updated!');
  process.exit(0);
}

main().catch(console.error);
