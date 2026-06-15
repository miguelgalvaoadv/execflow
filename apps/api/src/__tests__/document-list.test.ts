/**
 * Org document list — integration tests.
 *
 * Run: pnpm --filter @execflow/api test:document-list
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPoolDbClient } from '@execflow/db/client'
import type { ReadContext } from '../lib/read-context.ts'
import type { DbClient } from '../lib/db.ts'
import { listDocumentsForOrg, getDocumentDetail } from '../services/document-read.ts'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0012,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../../packages/db/src/migrations/test-utils/apply-migrations.ts'
import { insertDocumentListFixture } from './fixtures/document-list-fixture.ts'

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

describeWithDb('Org document list', () => {
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

  it('returns org documents ordered by uploadedAt desc', async () => {
    const fixture = await insertDocumentListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listDocumentsForOrg(ctx, {}, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 3)
    assert.equal(result.data.items[0]!.fileName, 'foto-rg.jpg')
    assert.equal(result.data.items[1]!.fileName, 'guia-prisao.pdf')
    assert.equal(result.data.items[2]!.fileName, 'sentenca.pdf')
    assert.equal(result.data.items[0]!.caseInternalRef, 'EXE-DOC-001')
  })

  it('filters by status', async () => {
    const fixture = await insertDocumentListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listDocumentsForOrg(ctx, { status: 'confirmed' }, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 1)
    assert.equal(result.data.items[0]!.status, 'confirmed')
  })

  it('filters by documentClass exact match', async () => {
    const fixture = await insertDocumentListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listDocumentsForOrg(ctx, { documentClass: 'guia' }, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.items.length, 1)
    assert.equal(result.data.items[0]!.documentClass, 'guia')
  })

  it('searches by q across file name and case ref', async () => {
    const fixture = await insertDocumentListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const byName = await listDocumentsForOrg(ctx, { q: 'guia' }, { limit: 50 })
    assert.equal(byName.success, true)
    if (!byName.success) return
    assert.equal(byName.data.items.length, 1)

    const byRef = await listDocumentsForOrg(ctx, { q: 'EXE-DOC-001' }, { limit: 50 })
    assert.equal(byRef.success, true)
    if (!byRef.success) return
    assert.equal(byRef.data.items.length, 2)
  })

  it('paginates with cursor without overlap', async () => {
    const fixture = await insertDocumentListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const page1 = await listDocumentsForOrg(ctx, {}, { limit: 2 })
    assert.equal(page1.success, true)
    if (!page1.success) return

    assert.equal(page1.data.items.length, 2)
    assert.ok(page1.data.nextCursor)

    const page2 = await listDocumentsForOrg(ctx, {}, { limit: 2, cursor: page1.data.nextCursor! })
    assert.equal(page2.success, true)
    if (!page2.success) return

    assert.equal(page2.data.items.length, 1)
    assert.equal(page2.data.nextCursor, null)

    const ids = [...page1.data.items, ...page2.data.items].map((i) => i.id)
    assert.equal(new Set(ids).size, 3)
  })

  it('returns document detail with case and client summaries', async () => {
    const fixture = await insertDocumentListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)
    const docId = fixture.documentIds[0]!

    const result = await getDocumentDetail(ctx, docId)
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.fileName, 'sentenca.pdf')
    assert.equal(result.data.caseSummary?.internalRef, 'EXE-DOC-001')
    assert.ok(result.data.clientSummary?.fullName)
    assert.equal(result.data.extraction, null)
    assert.equal(result.data.snapshotPromotion, null)
  })

  it('rejects invalid cursor', async () => {
    const fixture = await insertDocumentListFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await listDocumentsForOrg(ctx, {}, { limit: 10, cursor: 'invalid' })
    assert.equal(result.success, false)
    if (result.success) return
    assert.match(result.error.message, /cursor/i)
  })

  it('returns empty list for unknown org', async () => {
    const fixture = await insertDocumentListFixture(pgClient)
    const ctx = buildReadContext(db, {
      organizationId: randomUUID(),
      userId: fixture.userId,
    })

    const result = await listDocumentsForOrg(ctx, {}, { limit: 50 })
    assert.equal(result.success, true)
    if (!result.success) return
    assert.equal(result.data.items.length, 0)
  })
})
