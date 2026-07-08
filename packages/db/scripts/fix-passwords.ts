/**
 * Reseta a senha de contas DE DESENVOLVIMENTO específicas (nunca todas as
 * contas — achado 08/07/2026: a versão anterior deste script rodava
 * `db.update(authAccounts).set({ password })` SEM WHERE, resetando a senha
 * de TODA CONTA no banco, incluindo clientes reais do portal. Como este
 * projeto não separa banco de dev/produção (o DATABASE_URL do .env.local É
 * o Supabase real), isso era um risco sério de comprometer contas reais.
 *
 * Uso: tsx scripts/fix-passwords.ts --confirm
 * (o --confirm é obrigatório de propósito — sem ele, o script só mostra
 * quais contas SERIAM afetadas, sem escrever nada.)
 */
import { hashPassword } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { authAccounts } from '../src/schema/auth-account.ts';
import { users } from '../src/schema/user.ts';

const DEV_EMAILS = ['admin@execflow.local', 'cliente@execflow.local'];
const DEV_PASSWORD = 'ExecflowDevSmoke123!';

async function main() {
  const confirmed = process.argv.includes('--confirm');

  const sql = postgres(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const targets = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, DEV_EMAILS));

  if (targets.length === 0) {
    console.log('Nenhuma conta de dev encontrada (' + DEV_EMAILS.join(', ') + '). Nada a fazer.');
    process.exit(0);
  }

  console.log('Contas de dev encontradas:', targets.map((t) => t.email).join(', '));

  if (!confirmed) {
    console.log('Modo dry-run (sem --confirm) — nenhuma senha foi alterada. Rode com --confirm para aplicar.');
    process.exit(0);
  }

  const newHash = await hashPassword(DEV_PASSWORD);
  for (const target of targets) {
    await db.update(authAccounts).set({ password: newHash }).where(eq(authAccounts.userId, target.id));
  }
  console.log(`Senha resetada para ${targets.length} conta(s) de dev.`);
  process.exit(0);
}

main().catch(console.error);
