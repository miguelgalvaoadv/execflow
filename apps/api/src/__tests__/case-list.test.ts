/**
 * Execution case list — integration tests.
 *
 * Run: pnpm --filter @execflow/api test:case-list
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPoolDbClient } from '@execflow/db/client'
import type { ReadContext } from '../lib/read-context.ts'
import type { DbClient } from '../lib/db.ts'
import { listExecutionCasesForOrg } from '../services/case-read.ts'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0012,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../../packages/db/src/migrations/test-utils/apply-migrations.ts'
import { insertCaseListFixture } from './fixtures/case-list-fixture.ts'

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

describeWithDb('Execution case list', () => {
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

  it('returns org-scoped cases with client summary ordered by updatedAt desc', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listExecutionCasesForOrg(ctx, {}, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 3)
    assert.equal(result.data.items[0]!.internalRef, 'EXE-003')
    assert.equal(result.data.items[1]!.internalRef, 'EXE-002')
    assert.equal(result.data.items[2]!.internalRef, 'EXE-001')
    assert.equal(result.data.items[0]!.clientSummary.fullName, 'Snapshot Client')
    assert.match(result.data.items[0]!.updatedAt, /^\d{4}-\d{2}-\d{2}T/)
  })

  it('filters by status', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listExecutionCasesForOrg(ctx, { status: 'intake' }, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 1)
    assert.equal(result.data.items[0]!.status, 'intake')
    assert.equal(result.data.items[0]!.internalRef, 'EXE-001')
  })

  it('filters by courtJurisdiction exact match', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listExecutionCasesForOrg(
      ctx,
      { courtJurisdiction: 'Campinas/SP' },
      { limit: 50 }
    )
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 1)
    assert.equal(result.data.items[0]!.courtJurisdiction, 'Campinas/SP')
  })

  it('searches by q across client name and internal ref', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const byRef = await listExecutionCasesForOrg(ctx, { q: 'EXE-002' }, { limit: 50 })
    assert.equal(byRef.success, true)
    if (!byRef.success) return
    assert.equal(byRef.data.items.length, 1)
    assert.equal(byRef.data.items[0]!.internalRef, 'EXE-002')

    const byName = await listExecutionCasesForOrg(ctx, { q: 'Snapshot' }, { limit: 50 })
    assert.equal(byName.success, true)
    if (!byName.success) return
    assert.equal(byName.data.items.length, 3)
  })

  it('paginates with cursor without overlap', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const page1 = await listExecutionCasesForOrg(ctx, {}, { limit: 2 })
    assert.equal(page1.success, true)
    if (!page1.success) return

    assert.equal(page1.data.items.length, 2)
    assert.ok(page1.data.nextCursor)

    const page2 = await listExecutionCasesForOrg(
      ctx,
      {},
      { limit: 2, cursor: page1.data.nextCursor! }
    )
    assert.equal(page2.success, true)
    if (!page2.success) return

    assert.equal(page2.data.items.length, 1)
    assert.equal(page2.data.nextCursor, null)

    const ids = [...page1.data.items, ...page2.data.items].map((i) => i.id)
    assert.equal(new Set(ids).size, 3)
  })

  it('excludes soft-deleted cases', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    await pgClient.query(
      `UPDATE execution_cases SET deleted_at = NOW() WHERE internal_ref = 'EXE-003'`
    )
    const ctx = buildReadContext(db, fixture)

    const result = await listExecutionCasesForOrg(ctx, {}, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 2)
    assert.ok(result.data.items.every((i) => i.internalRef !== 'EXE-003'))
  })

  it('rejects invalid cursor', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listExecutionCasesForOrg(ctx, {}, { limit: 10, cursor: 'invalid' })
    assert.equal(result.success, false)
    if (result.success) return
    assert.match(result.error.message, /cursor/i)
  })

  it('denies assistant without membership role resolution failure', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    const ctx = buildReadContext(db, { ...fixture, role: 'assistant' })

    const result = await listExecutionCasesForOrg(ctx, {}, { limit: 10 })
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.data.items.length >= 1)
  })

  it('returns empty list for unknown org', async () => {
    const fixture = await insertCaseListFixture(pgClient)
    const ctx = buildReadContext(db, {
      organizationId: randomUUID(),
      userId: fixture.userId,
    })

    const result = await listExecutionCasesForOrg(ctx, {}, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return
    assert.equal(result.data.items.length, 0)
    assert.equal(result.data.nextCursor, null)
  })
})
