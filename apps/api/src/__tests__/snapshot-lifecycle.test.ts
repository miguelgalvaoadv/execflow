/**
 * Snapshot lifecycle API — integration tests.
 *
 * Covers: propose → confirm → supersede for sentence and custody snapshots,
 * domain events, audit logs, and engine loader compatibility.
 *
 * Requires MIGRATION_TEST_DATABASE_URL (disposable PostgreSQL).
 *
 * Run: pnpm --filter @execflow/api test:snapshots
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { eq, and } from '@execflow/db/client'
import { createPoolDbClient } from '@execflow/db/client'
import {
  auditLogs,
  domainEvents,
  sentenceSnapshots,
  custodySnapshots,
} from '@execflow/db/schema'
import { loadCaseFacts } from '@execflow/engine'
import type { WriteContext } from '../lib/write-context.ts'
import type { DbClient } from '../lib/db.ts'
import {
  proposeSentenceSnapshot,
  confirmSentenceSnapshot,
  supersedeSentenceSnapshot,
} from '../services/sentence-snapshot.ts'
import {
  proposeCustodySnapshot,
  confirmCustodySnapshot,
  supersedeCustodySnapshot,
} from '../services/custody-snapshot.ts'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0008,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../../packages/db/src/migrations/test-utils/apply-migrations.ts'
import { insertSnapshotLifecycleFixture } from './fixtures/snapshot-lifecycle-fixture.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

function buildTestWriteContext(
  db: DbClient,
  params: { organizationId: string; userId: string }
): WriteContext {
  const requestId = randomUUID()
  return {
    db,
    actor: {
      actorType: 'user',
      actorId: params.userId,
      actorRole: 'lawyer',
      impersonatingUserId: null,
      sessionToken: 'test-session',
      ipAddress: null,
    },
    organizationId: params.organizationId,
    userId: params.userId,
    requestId,
    correlationId: requestId,
  }
}

describeWithDb('snapshot lifecycle API', () => {
  let pool: pg.Pool
  let pgClient: pg.PoolClient
  let db: DbClient

  before(async () => {
    pool = createMigrationTestPool(databaseUrl!)
    pgClient = await pool.connect()
    db = createPoolDbClient(databaseUrl!) as unknown as DbClient
  })

  after(async () => {
    pgClient.release()
    await pool.end()
  })

  async function freshSchema(): Promise<void> {
    await resetPublicSchema(pgClient)
    await applyMigrationFiles(pgClient, ALL_MIGRATIONS_THROUGH_0008)
  }

  it('sentence: propose → confirm emits snapshot.confirmed and loads in engine', async () => {
    await freshSchema()
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const ctx = buildTestWriteContext(db, fixture)

    const effectiveAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

    const proposed = await proposeSentenceSnapshot(ctx, fixture.executionCaseId, {
      effectiveAt,
      totalSentenceDays: 1000,
      servedDays: 200,
      confidenceLevel: 'high',
      playbookVersionId: fixture.playbookVersionId,
    })
    assert.equal(proposed.success, true)
    if (!proposed.success) return

    assert.equal(proposed.data.status, 'proposed')
    assert.equal(proposed.data.remainingDays, 800)
    assert.equal(String(proposed.data.percentServed), '0.2000')

    const confirmed = await confirmSentenceSnapshot(ctx, proposed.data.id)
    assert.equal(confirmed.success, true)
    if (!confirmed.success) return

    assert.equal(confirmed.data.status, 'confirmed')
    assert.equal(confirmed.data.confirmedByUserId, fixture.userId)

    const [confirmEvent] = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, 'snapshot.confirmed'),
          eq(domainEvents.aggregateId, proposed.data.id)
        )
      )
      .limit(1)

    assert.ok(confirmEvent, 'snapshot.confirmed domain event must be written')

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'SentenceSnapshot'),
          eq(auditLogs.entityId, proposed.data.id),
          eq(auditLogs.action, 'confirmed')
        )
      )
      .limit(1)

    assert.ok(audit, 'audit log for confirmation must exist')

    const facts = await loadCaseFacts(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      evaluatedAt: new Date(),
    })

    assert.ok(facts.sentence !== null, 'engine loader must read confirmed sentence snapshot')
    assert.equal(facts.sentence?.totalSentenceDays, 1000)
    assert.equal(facts.sentence?.servedDays, 200)
  })

  it('sentence: supersede preserves history and emits sentence.snapshot.superseded', async () => {
    await freshSchema()
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const ctx = buildTestWriteContext(db, fixture)

    const effectiveAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()

    const proposed = await proposeSentenceSnapshot(ctx, fixture.executionCaseId, {
      effectiveAt,
      totalSentenceDays: 800,
      servedDays: 100,
      playbookVersionId: fixture.playbookVersionId,
    })
    assert.equal(proposed.success, true)
    if (!proposed.success) return

    const confirmed = await confirmSentenceSnapshot(ctx, proposed.data.id)
    assert.equal(confirmed.success, true)
    if (!confirmed.success) return

    const supersedeEffectiveAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const superseded = await supersedeSentenceSnapshot(ctx, proposed.data.id, {
      reason: 'Updated served days after court order',
      effectiveAt: supersedeEffectiveAt,
      totalSentenceDays: 800,
      servedDays: 250,
    })
    assert.equal(superseded.success, true)
    if (!superseded.success) return

    assert.equal(superseded.data.superseded.status, 'superseded')
    assert.equal(superseded.data.replacement.status, 'proposed')
    assert.equal(superseded.data.replacement.amendsSnapshotId, proposed.data.id)

    const allRows = await db
      .select()
      .from(sentenceSnapshots)
      .where(eq(sentenceSnapshots.executionCaseId, fixture.executionCaseId))

    assert.equal(allRows.length, 2, 'append-only: both rows must remain')

    const [supersedeEvent] = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, 'sentence.snapshot.superseded'),
          eq(domainEvents.aggregateId, proposed.data.id)
        )
      )
      .limit(1)

    assert.ok(supersedeEvent)

    const factsBeforeReplacementConfirm = await loadCaseFacts(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      evaluatedAt: new Date(),
    })

    assert.equal(
      factsBeforeReplacementConfirm.sentence,
      null,
      'engine must not read superseded or proposed snapshots — gap until replacement is confirmed'
    )

    const replacementConfirmed = await confirmSentenceSnapshot(
      ctx,
      superseded.data.replacement.id
    )
    assert.equal(replacementConfirmed.success, true)

    const factsAfter = await loadCaseFacts(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      evaluatedAt: new Date(),
    })

    assert.equal(factsAfter.sentence?.snapshotId, superseded.data.replacement.id)
    assert.equal(factsAfter.sentence?.servedDays, 250)
  })

  it('custody: propose → confirm emits custody.snapshot.created', async () => {
    await freshSchema()
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const ctx = buildTestWriteContext(db, fixture)

    const effectiveAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

    const proposed = await proposeCustodySnapshot(ctx, fixture.executionCaseId, {
      effectiveAt,
      regime: 'fechado',
      confidence: 'high',
    })
    assert.equal(proposed.success, true)
    if (!proposed.success) return

    assert.equal(proposed.data.confirmedByUserId, null)

    const confirmed = await confirmCustodySnapshot(ctx, proposed.data.id)
    assert.equal(confirmed.success, true)
    if (!confirmed.success) return

    assert.equal(confirmed.data.confirmedByUserId, fixture.userId)

    const [createdEvent] = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, 'custody.snapshot.created'),
          eq(domainEvents.aggregateId, proposed.data.id)
        )
      )
      .limit(1)

    assert.ok(createdEvent, 'custody.snapshot.created must be emitted on confirm')

    const facts = await loadCaseFacts(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      evaluatedAt: new Date(),
    })

    assert.ok(facts.custody !== null)
    assert.equal(facts.custody?.regime, 'fechado')
  })

  it('custody: supersede preserves history; replacement requires confirm', async () => {
    await freshSchema()
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const ctx = buildTestWriteContext(db, fixture)

    const effectiveAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()

    const proposed = await proposeCustodySnapshot(ctx, fixture.executionCaseId, {
      effectiveAt,
      regime: 'fechado',
    })
    assert.equal(proposed.success, true)
    if (!proposed.success) return

    await confirmCustodySnapshot(ctx, proposed.data.id)

    const supersedeEffectiveAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const superseded = await supersedeCustodySnapshot(ctx, proposed.data.id, {
      reason: 'Regime change per court order',
      effectiveAt: supersedeEffectiveAt,
      regime: 'semiaberto',
    })
    assert.equal(superseded.success, true)
    if (!superseded.success) return

    assert.ok(superseded.data.superseded.supersededAt !== null)
    assert.equal(
      superseded.data.superseded.supersededBySnapshotId,
      superseded.data.replacement.id
    )
    assert.equal(superseded.data.replacement.confirmedByUserId, null)

    const allRows = await db
      .select()
      .from(custodySnapshots)
      .where(eq(custodySnapshots.executionCaseId, fixture.executionCaseId))

    assert.equal(allRows.length, 2)

    const [supersedeEvent] = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, 'custody.snapshot.superseded'),
          eq(domainEvents.aggregateId, proposed.data.id)
        )
      )
      .limit(1)

    assert.ok(supersedeEvent)

    await confirmCustodySnapshot(ctx, superseded.data.replacement.id)

    const facts = await loadCaseFacts(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      evaluatedAt: new Date(),
    })

    assert.equal(facts.custody?.regime, 'semiaberto')
  })

  it('rejects confirm on already confirmed sentence snapshot', async () => {
    await freshSchema()
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const ctx = buildTestWriteContext(db, fixture)

    const proposed = await proposeSentenceSnapshot(ctx, fixture.executionCaseId, {
      effectiveAt: new Date().toISOString(),
      totalSentenceDays: 365,
    })
    assert.equal(proposed.success, true)
    if (!proposed.success) return

    await confirmSentenceSnapshot(ctx, proposed.data.id)
    const again = await confirmSentenceSnapshot(ctx, proposed.data.id)
    assert.equal(again.success, false)
    if (again.success) return
    assert.equal(again.error.code, 'VALIDATION')
  })
})
