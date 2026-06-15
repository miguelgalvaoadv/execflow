/**
 * Org deadline list — integration tests.
 *
 * Run: pnpm --filter @execflow/api test:deadline-list
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPoolDbClient } from '@execflow/db/client'
import type { ReadContext } from '../lib/read-context.ts'
import type { DbClient } from '../lib/db.ts'
import {
  listDeadlinesForOrg,
  getDeadlineDetail,
  listDeadlineHistory,
} from '../services/deadline-read.ts'
import { acknowledgeDeadline } from '../services/deadline.ts'
import type { WriteContext } from '../lib/write-context.ts'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0012,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../../packages/db/src/migrations/test-utils/apply-migrations.ts'
import { insertDeadlineListFixture } from './fixtures/deadline-list-fixture.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

function buildReadContext(
  db: DbClient,
  params: {
    organizationId: string
    userId: string
    role?: 'assistant' | 'lawyer'
  }
): ReadContext {
  return {
    db,
    organizationId: params.organizationId,
    userId: params.userId,
    actor: {
      actorType: 'user',
      actorId: params.userId,
      actorRole: params.role ?? 'lawyer',
      impersonatingUserId: null,
      sessionToken: null,
      ipAddress: '127.0.0.1',
    },
  }
}

function buildWriteContext(
  db: DbClient,
  params: {
    organizationId: string
    userId: string
    role?: 'assistant' | 'lawyer'
  }
): WriteContext {
  return {
    db,
    organizationId: params.organizationId,
    userId: params.userId,
    actor: {
      actorType: 'user',
      actorId: params.userId,
      actorRole: params.role ?? 'lawyer',
      impersonatingUserId: null,
      sessionToken: null,
      ipAddress: '127.0.0.1',
    },
    requestId: randomUUID(),
    correlationId: randomUUID(),
  }
}

describeWithDb('Org deadline list', () => {
  let pool: pg.Pool
  let pgClient: pg.PoolClient
  let db: DbClient

  before(async () => {
    pool = createMigrationTestPool(databaseUrl!)
    pgClient = await pool.connect()
    db = createPoolDbClient(databaseUrl!)
  })

  after(async () => {
    pgClient.release()
    await pool.end()
  })

  beforeEach(async () => {
    await resetPublicSchema(pgClient)
    await applyMigrationFiles(pgClient, ALL_MIGRATIONS_THROUGH_0012)
  })

  it('returns org deadlines ordered by dueAt asc', async () => {
    const fixture = await insertDeadlineListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listDeadlinesForOrg(ctx, {}, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 3)
    assert.equal(result.data.items[0]!.title, 'Prazo vencido teste')
    assert.equal(result.data.items[1]!.title, 'Manifestação inicial')
    assert.equal(result.data.items[2]!.title, 'Revisão de progressão')
    assert.equal(result.data.items[0]!.caseInternalRef, 'EXE-DL-001')
  })

  it('filters by status', async () => {
    const fixture = await insertDeadlineListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listDeadlinesForOrg(ctx, { status: 'overdue' }, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 1)
    assert.equal(result.data.items[0]!.status, 'overdue')
  })

  it('filters by priority', async () => {
    const fixture = await insertDeadlineListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listDeadlinesForOrg(ctx, { priority: 'critical' }, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 1)
    assert.equal(result.data.items[0]!.priority, 'critical')
  })

  it('searches by q across title and case ref', async () => {
    const fixture = await insertDeadlineListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const byTitle = await listDeadlinesForOrg(ctx, { q: 'progressão' }, { limit: 50 })
    assert.equal(byTitle.success, true)
    if (!byTitle.success) return
    assert.equal(byTitle.data.items.length, 1)

    const byRef = await listDeadlinesForOrg(ctx, { q: 'EXE-DL-001' }, { limit: 50 })
    assert.equal(byRef.success, true)
    if (!byRef.success) return
    assert.equal(byRef.data.items.length, 3)
  })

  it('paginates with cursor without overlap', async () => {
    const fixture = await insertDeadlineListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const page1 = await listDeadlinesForOrg(ctx, {}, { limit: 2 })
    assert.equal(page1.success, true)
    if (!page1.success) return

    assert.equal(page1.data.items.length, 2)
    assert.ok(page1.data.nextCursor)

    const page2 = await listDeadlinesForOrg(ctx, {}, { limit: 2, cursor: page1.data.nextCursor! })
    assert.equal(page2.success, true)
    if (!page2.success) return

    assert.equal(page2.data.items.length, 1)
    assert.equal(page2.data.nextCursor, null)

    const ids = [...page1.data.items, ...page2.data.items].map((i) => i.id)
    assert.equal(new Set(ids).size, 3)
  })

  it('returns deadline detail with case summary', async () => {
    const fixture = await insertDeadlineListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)
    const deadlineId = fixture.deadlineIds[0]!

    const result = await getDeadlineDetail(ctx, deadlineId)
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.title, 'Manifestação inicial')
    assert.equal(result.data.caseSummary.internalRef, 'EXE-DL-001')
    assert.equal(result.data.priority, 'critical')
  })

  it('returns history after acknowledge', async () => {
    const fixture = await insertDeadlineListFixture(pgClient)
    const writeCtx = buildWriteContext(db, fixture)
    const readCtx = buildReadContext(db, fixture)
    const deadlineId = fixture.deadlineIds[0]!

    const ack = await acknowledgeDeadline(writeCtx, deadlineId)
    assert.equal(ack.success, true)

    const history = await listDeadlineHistory(readCtx, deadlineId)
    assert.equal(history.success, true)
    if (!history.success) return

    assert.ok(history.data.length >= 1)
    assert.equal(history.data[0]!.changeType, 'acknowledged')
  })

  it('rejects invalid cursor', async () => {
    const fixture = await insertDeadlineListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listDeadlinesForOrg(ctx, {}, { limit: 10, cursor: 'invalid' })
    assert.equal(result.success, false)
    if (result.success) return
    assert.match(result.error.message, /cursor/i)
  })
})
