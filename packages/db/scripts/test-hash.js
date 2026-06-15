import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envFileContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envFileContent.split('\n')) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key] = val;
    }
  }
}

const connectionString = process.env.DATABASE_URL;
const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  console.log('Connected to database.');

  const resUser = await client.query('SELECT * FROM "ba_user" WHERE email = $1', ['admin@execflow.local']);
  console.log('User in "ba_user" table (Better Auth schema):', resUser.rows);

  const resAccount = await client.query('SELECT * FROM ba_account WHERE "user_id" = $1', [resUser.rows[0]?.id]);
  console.log('Account for user in ba_account table:', resAccount.rows);

  if (resAccount.rows.length > 0) {
    const account = resAccount.rows[0];
    const passwordHash = account.password;
    console.log('Stored Password Hash:', passwordHash);

    const testPassword = 'ExecflowDevSmoke123!';
    const isValid = await verifyPassword({
      password: testPassword,
      hash: passwordHash
    });
    console.log(`Verification of '${testPassword}':`, isValid);

    // Let's generate a fresh hash using the current runtime and verify it
    const newHash = await hashPassword(testPassword);
    console.log('Newly generated hash:', newHash);
    const isNewValid = await verifyPassword({
      password: testPassword,
      hash: newHash
    });
    console.log('Verification of new hash:', isNewValid);
  }

  await client.end();
}

main().catch(console.error);
