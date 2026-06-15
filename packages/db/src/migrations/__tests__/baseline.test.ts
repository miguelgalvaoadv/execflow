import { describe, it, before, after } from 'node:test'
import * as assert from 'node:assert'
import pg from 'pg'
import {
  resolveMigrationTestDatabaseUrl,
  createMigrationTestPool,
  resetPublicSchema,
  applyMigrationFiles,
  ALL_CURRENT_MIGRATIONS,
  queryIsReplayColumnType,
  queryDeadlineHistoryActorColumns,
} from '../test-utils/apply-migrations.js'

describe('Database Baseline V2', () => {
  let pool: pg.Pool
  let client: pg.PoolClient

  before(async () => {
    const databaseUrl = resolveMigrationTestDatabaseUrl()
    if (!databaseUrl) {
      return // skip tests
    }
    pool = createMigrationTestPool(databaseUrl)
    client = await pool.connect()
    await resetPublicSchema(client)
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    await applyMigrationFiles(client, ALL_CURRENT_MIGRATIONS)
  })

  after(async () => {
    if (client) client.release()
    if (pool) await pool.end()
  })

  it('applies baseline and triggers without errors', async (t) => {
    if (!client) {
      t.skip('MIGRATION_TEST_DATABASE_URL not set')
      return
    }
    const { rows } = await client.query(
      `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
    const count = parseInt(rows[0].count, 10)
    assert.ok(count >= 41, `Expected at least 41 tables, got ${count}`)
  })

  it('engine_runs.is_replay is a boolean', async (t) => {
    if (!client) {
      t.skip('MIGRATION_TEST_DATABASE_URL not set')
      return
    }
    const type = await queryIsReplayColumnType(client)
    assert.strictEqual(type, 'boolean')
  })

  it('deadline_history has required actor attribution columns', async (t) => {
    if (!client) {
      t.skip('MIGRATION_TEST_DATABASE_URL not set')
      return
    }
    const cols = await queryDeadlineHistoryActorColumns(client)
    
    const actorId = cols.find(c => c.column_name === 'changed_by_actor_id')
    assert.ok(actorId, 'Missing changed_by_actor_id')
    assert.strictEqual(actorId.is_nullable, 'NO')

    const actorType = cols.find(c => c.column_name === 'changed_by_actor_type')
    assert.ok(actorType, 'Missing changed_by_actor_type')
    assert.strictEqual(actorType.is_nullable, 'NO')

    const userId = cols.find(c => c.column_name === 'changed_by_user_id')
    assert.ok(userId, 'Missing changed_by_user_id')
    assert.strictEqual(userId.is_nullable, 'YES')
  })
})
