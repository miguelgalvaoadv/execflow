/**
 * APAGA O BANCO INTEIRO (TRUNCATE CASCADE a partir de organizations —
 * derruba clientes, casos, documentos, prazos, oportunidades, tudo).
 *
 * Achado 08/07/2026: este script não tinha NENHUMA proteção — rodar
 * `tsx scripts/truncate.ts` sem querer apagava os 39 clientes reais
 * cadastrados, porque este projeto não separa banco de dev/produção (o
 * DATABASE_URL do .env.local É o Supabase real usado em produção).
 *
 * Uso: tsx scripts/truncate.ts --confirm-wipe-everything
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

async function main() {
  if (!process.argv.includes('--confirm-wipe-everything')) {
    console.error(
      'ABORTADO: este script apaga TUDO (organizations CASCADE — clientes, casos, documentos, prazos, tudo).\n' +
        'Se você tem certeza absoluta que quer apagar o banco inteiro (' +
        (process.env.DATABASE_URL ?? 'DATABASE_URL não definido') +
        '), rode de novo com --confirm-wipe-everything.'
    );
    process.exit(1);
  }

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
