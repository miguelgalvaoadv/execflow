/**
 * Test utilities — apply SQL migrations to a fresh PostgreSQL database.
 *
 * Used by migration integration tests only. Requires MIGRATION_TEST_DATABASE_URL
 * pointing at a disposable database (never use production).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
)

export const BASELINE_V2 = '0000_baseline_v2.sql'
export const POST_BASELINE_TRIGGERS = 'post_baseline_triggers.sql'

export const ALL_CURRENT_MIGRATIONS = [
  BASELINE_V2,
  POST_BASELINE_TRIGGERS,
] as const

export function resolveMigrationTestDatabaseUrl(): string | undefined {
  return (
    process.env['MIGRATION_TEST_DATABASE_URL']?.trim() ||
    process.env['TEST_DATABASE_URL']?.trim() ||
    undefined
  )
}

export function createMigrationTestPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 4 })
}

/**
 * Drops and recreates public schema — destructive; test DB only.
 */
export async function resetPublicSchema(client: pg.PoolClient): Promise<void> {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE')
  await client.query('CREATE SCHEMA public')
  await client.query('GRANT ALL ON SCHEMA public TO public')
  await client.query('GRANT ALL ON SCHEMA public TO CURRENT_USER')
}

export async function applyMigrationFiles(
  client: pg.PoolClient,
  files: readonly string[]
): Promise<void> {
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    await client.query(sql)
  }
}

/** All .sql migration filenames in lexical order. */
export function listMigrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export async function queryIsReplayColumnType(
  client: pg.PoolClient
): Promise<string | null> {
  const meta = await queryIsReplayColumnMeta(client)
  return meta?.data_type ?? null
}

export type IsReplayColumnMeta = {
  data_type: string
  is_nullable: string
  column_default: string | null
}

export async function queryIsReplayColumnMeta(
  client: pg.PoolClient
): Promise<IsReplayColumnMeta | null> {
  const { rows } = await client.query<IsReplayColumnMeta>(
    `SELECT data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'engine_runs'
       AND column_name = 'is_replay'`
  )
  return rows[0] ?? null
}

export type DeadlineHistoryActorColumnMeta = {
  column_name: string
  is_nullable: string
}

export async function queryDeadlineHistoryActorColumns(
  client: pg.PoolClient
): Promise<DeadlineHistoryActorColumnMeta[]> {
  const { rows } = await client.query<DeadlineHistoryActorColumnMeta>(
    `SELECT column_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'deadline_history'
       AND column_name IN (
         'changed_by_actor_type',
         'changed_by_actor_id',
         'changed_by_user_id',
         'causing_event_id'
       )
     ORDER BY column_name`
  )
  return rows
}
