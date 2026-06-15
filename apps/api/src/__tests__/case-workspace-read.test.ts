/**
 * Case Workspace read foundation — integration tests.
 *
 * Run: pnpm --filter @execflow/api test:case-read
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPoolDbClient } from '@execflow/db/client'
import type { ReadContext } from '../lib/read-context.ts'
import type { DbClient } from '../lib/db.ts'
import { getExecutionCaseDetail } from '../services/case-read.ts'
import { getClientDetail } from '../services/client-read.ts'
import {
  listCaseTimeline,
  listCaseDocuments,
  listCaseOpportunities,
  listCaseDeadlines,
} from '../services/case-workspace-read.ts'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0012,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../../packages/db/src/migrations/test-utils/apply-migrations.ts'
import { insertCaseWorkspaceReadFixture } from './fixtures/case-workspace-read-fixture.ts'

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

describeWithDb('Case Workspace read foundation', () => {
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

  it('returns execution case detail with client summary', async () => {
    const fixture = await insertCaseWorkspaceReadFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const result = await getExecutionCaseDetail(ctx, fixture.executionCaseId)
    assert.equal(result.success, true)
    if (!result.success) return

    assert.equal(result.data.id, fixture.executionCaseId)
    assert.equal(result.data.clientId, fixture.clientId)
    assert.equal(result.data.clientSummary.id, fixture.clientId)
    assert.equal(result.data.clientSummary.fullName, 'Snapshot Client')
  })

  it('returns client detail with LGPD filtering for assistant role', async () => {
    const fixture = await insertCaseWorkspaceReadFixture(pgClient)

    const lawyerCtx = buildReadContext(db, { ...fixture, role: 'lawyer' })
    const lawyerResult = await getClientDetail(lawyerCtx, fixture.clientId)
    assert.equal(lawyerResult.success, true)
    if (lawyerResult.success) {
      assert.equal(lawyerResult.data.cpf, '12345678901')
      assert.ok(lawyerResult.data.contactChannels?.length)
    }

    const assistantCtx = buildReadContext(db, {
      organizationId: fixture.organizationId,
      userId: fixture.assistantUserId,
      role: 'assistant',
    })
    const assistantResult = await getClientDetail(assistantCtx, fixture.clientId)
    assert.equal(assistantResult.success, true)
    if (assistantResult.success) {
      assert.equal(assistantResult.data.cpf, undefined)
      assert.equal(assistantResult.data.contactChannels, undefined)
      assert.equal(assistantResult.data.fullName, 'Snapshot Client')
    }
  })

  it('lists case timeline, documents, opportunities, and deadlines', async () => {
    const fixture = await insertCaseWorkspaceReadFixture(pgClient)
    const ctx = buildReadContext(db, fixture)

    const timeline = await listCaseTimeline(ctx, fixture.executionCaseId, { limit: 50 })
    assert.equal(timeline.success, true)
    if (timeline.success) {
      assert.ok(timeline.data.items.some((e) => e.id === fixture.timelineEventId))
    }

    const documents = await listCaseDocuments(ctx, fixture.executionCaseId, { limit: 50 })
    assert.equal(documents.success, true)
    if (documents.success) {
      assert.equal(documents.data.items.length, 1)
      assert.equal(documents.data.items[0]?.id, fixture.documentId)
      assert.equal(documents.data.items[0]?.fileName, 'sentenca.pdf')
    }

    const opportunities = await listCaseOpportunities(ctx, fixture.executionCaseId, { limit: 50 })
    assert.equal(opportunities.success, true)
    if (opportunities.success) {
      assert.equal(opportunities.data.items.length, 1)
      assert.equal(opportunities.data.items[0]?.id, fixture.opportunityId)
    }

    const deadlines = await listCaseDeadlines(ctx, fixture.executionCaseId, { limit: 50 })
    assert.equal(deadlines.success, true)
    if (deadlines.success) {
      assert.equal(deadlines.data.items.length, 1)
      assert.equal(deadlines.data.items[0]?.id, fixture.deadlineId)
    }
  })

  it('returns not found for missing case on list endpoints', async () => {
    const fixture = await insertCaseWorkspaceReadFixture(pgClient)
    const ctx = buildReadContext(db, fixture)
    const missingId = randomUUID()

    const timeline = await listCaseTimeline(ctx, missingId, { limit: 10 })
    assert.equal(timeline.success, false)
    if (!timeline.success) assert.equal(timeline.error.code, 'NOT_FOUND')

    const documents = await listCaseDocuments(ctx, missingId, { limit: 10 })
    assert.equal(documents.success, false)
  })

  it('paginates timeline with cursor', async () => {
    const fixture = await insertCaseWorkspaceReadFixture(pgClient)

    for (let i = 0; i < 3; i++) {
      await pgClient.query(
        `INSERT INTO timeline_events (
           id, organization_id, execution_case_id, event_type, event_category,
           occurred_at, recorded_at, summary, payload, source, visibility,
           actor_type, actor_id, author_user_id
         ) VALUES (
           $1, $2, $3, 'office.note', 'internal', NOW() - ($4::text || ' hours')::interval, NOW(),
           $5, '{}'::jsonb, 'manual', 'internal', 'user', $6::text, $7
         )`,
        [
          randomUUID(),
          fixture.organizationId,
          fixture.executionCaseId,
          String(i + 2),
          `Nota ${i}`,
          fixture.userId,
          fixture.userId,
        ]
      )
    }

    const ctx = buildReadContext(db, fixture)
    const page1 = await listCaseTimeline(ctx, fixture.executionCaseId, { limit: 2 })
    assert.equal(page1.success, true)
    if (!page1.success) return
    assert.equal(page1.data.items.length, 2)
    assert.ok(page1.data.nextCursor)

    const page2 = await listCaseTimeline(ctx, fixture.executionCaseId, {
      limit: 2,
      cursor: page1.data.nextCursor!,
    })
    assert.equal(page2.success, true)
    if (page2.success) {
      assert.ok(page2.data.items.length >= 1)
    }
  })
})
