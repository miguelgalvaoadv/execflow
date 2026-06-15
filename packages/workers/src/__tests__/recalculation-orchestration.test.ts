/**
 * Recalculation orchestration loop — integration tests.
 *
 * Covers: schedule → domain event → worker → evaluation → commit → lifecycle.
 *
 * Requires MIGRATION_TEST_DATABASE_URL (disposable PostgreSQL).
 *
 * Run: pnpm --filter @execflow/workers test:orchestration
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { eq, and } from '@execflow/db/client'
import {
  domainEvents,
  recalculationRuns,
  engineRuns,
} from '@execflow/db/schema'
import {
  scheduleRecalculation,
  invalidateDependencies,
} from '@execflow/engine'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_CURRENT_MIGRATIONS,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../db/src/migrations/test-utils/apply-migrations.ts'
import { createWorkersDb } from '../lib/db.ts'
import {
  handleEngineEvaluationRequested,
  handleTimelineEventForEngine,
} from '../consumers/engine-events.ts'
import {
  insertEngineEvalFixture,
  insertConfirmedSnapshots,
  buildEvaluationRequestedJob,
} from './fixtures/engine-eval-fixture.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

describeWithDb('recalculation orchestration loop', () => {
  let pool: pg.Pool
  let pgClient: pg.PoolClient
  let db: ReturnType<typeof createWorkersDb>

  before(async () => {
    pool = createMigrationTestPool(databaseUrl!)
    pgClient = await pool.connect()
    db = createWorkersDb(databaseUrl!)
  })

  after(async () => {
    pgClient.release()
    await pool.end()
  })

  async function freshSchema(): Promise<void> {
    await resetPublicSchema(pgClient)
    await pgClient.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    await applyMigrationFiles(pgClient, ALL_CURRENT_MIGRATIONS)
  }

  it('scheduleRecalculation persists run + engine.evaluation.requested with causality', async () => {
    await freshSchema()
    const fixture = await insertEngineEvalFixture(pgClient)
    await insertConfirmedSnapshots(db, fixture)

    const upstreamEventId = randomUUID()
    const correlationId = randomUUID()
    const triggerEntityId = fixture.timelineEventId

    await pgClient.query(
      `INSERT INTO domain_events (
         id, event_type, aggregate_type, aggregate_id,
         correlation_id, organization_id, actor_type, actor_id,
         occurred_at, payload, replayable, processing_status
       ) VALUES ($1, 'timeline.event.appended', 'TimelineEvent', $2,
         $3, $4, 'system', 'test', NOW(), '{}'::jsonb, TRUE, 'published')`,
      [upstreamEventId, triggerEntityId, correlationId, fixture.organizationId]
    )

    const recalcRunId = await scheduleRecalculation(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      triggerEntityType: 'timeline_event',
      triggerEntityId,
      triggerReason: 'Timeline event appended: benefit.granted',
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
      causationId: upstreamEventId,
      jurisdictionScope: 'BR-FED',
    })

    assert.ok(recalcRunId, 'scheduleRecalculation must return run id')

    const [runRow] = await db
      .select()
      .from(recalculationRuns)
      .where(eq(recalculationRuns.id, recalcRunId!))
      .limit(1)

    assert.equal(runRow?.status, 'scheduled')
    assert.equal(runRow?.correlationId, correlationId)

    const [evalEvent] = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, 'engine.evaluation.requested'),
          eq(domainEvents.aggregateId, recalcRunId!)
        )
      )
      .limit(1)

    assert.ok(evalEvent, 'engine.evaluation.requested must be written to outbox')
    assert.equal(evalEvent.causationId, upstreamEventId)
    assert.equal(evalEvent.correlationId, correlationId)
    assert.equal(evalEvent.processingStatus, 'pending')

    const payload = evalEvent.payload as Record<string, unknown>
    assert.equal(payload['recalculationRunId'], recalcRunId)
    assert.equal(payload['executionCaseId'], fixture.executionCaseId)
    assert.equal(payload['organizationId'], fixture.organizationId)
    assert.equal(payload['trigger'], 'recalculation')
    assert.equal(payload['triggerEntityType'], 'timeline_event')
    assert.equal(payload['triggerEntityId'], triggerEntityId)
    assert.equal(payload['jurisdictionScope'], 'BR-FED')
  })

  it('worker completes lifecycle: scheduled → running → completed + producedEngineRunId', async () => {
    await freshSchema()
    const fixture = await insertEngineEvalFixture(pgClient)
    await insertConfirmedSnapshots(db, fixture)

    const upstreamEventId = randomUUID()
    const correlationId = randomUUID()

    const recalcRunId = await scheduleRecalculation(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      triggerEntityType: 'timeline_event',
      triggerEntityId: fixture.timelineEventId,
      triggerReason: 'Timeline event appended: benefit.granted',
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
      causationId: upstreamEventId,
    })

    assert.ok(recalcRunId)

    const [evalEvent] = await db
      .select({ id: domainEvents.id, payload: domainEvents.payload })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, recalcRunId!))
      .limit(1)

    assert.ok(evalEvent)

    const job = buildEvaluationRequestedJob({
      eventId: evalEvent.id,
      organizationId: fixture.organizationId,
      correlationId,
      causationId: upstreamEventId,
      payload: evalEvent.payload as Record<string, unknown>,
    })

    await handleEngineEvaluationRequested(db, job as import('pg-boss').Job<unknown>)

    const [completedRun] = await db
      .select()
      .from(recalculationRuns)
      .where(eq(recalculationRuns.id, recalcRunId!))
      .limit(1)

    assert.equal(completedRun?.status, 'completed')
    assert.ok(completedRun?.startedAt)
    assert.ok(completedRun?.completedAt)
    assert.ok(completedRun?.producedEngineRunId)

    const [engineRun] = await db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.id, completedRun!.producedEngineRunId!))
      .limit(1)

    assert.equal(engineRun?.status, 'completed')
    assert.equal(engineRun?.trigger, 'recalculation')
    assert.equal(engineRun?.isReplay, false)
  })

  it('failure path: scheduled → running → failed when evaluation cannot run', async () => {
    await freshSchema()
    const fixture = await insertEngineEvalFixture(pgClient)

    const upstreamEventId = randomUUID()
    const correlationId = randomUUID()

    const recalcRunId = await scheduleRecalculation(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      triggerEntityType: 'timeline_event',
      triggerEntityId: fixture.timelineEventId,
      triggerReason: 'test failure path',
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
      causationId: upstreamEventId,
      jurisdictionScope: 'XX-NONE',
    })

    assert.ok(recalcRunId)

    const [evalEvent] = await db
      .select({ id: domainEvents.id, payload: domainEvents.payload })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, recalcRunId!))
      .limit(1)

    const job = buildEvaluationRequestedJob({
      eventId: evalEvent!.id,
      organizationId: fixture.organizationId,
      correlationId,
      causationId: upstreamEventId,
      payload: evalEvent!.payload as Record<string, unknown>,
    })

    await assert.rejects(
      () => handleEngineEvaluationRequested(db, job as import('pg-boss').Job<unknown>),
      /Cannot run evaluation|No base playbook family/
    )

    const [failedRun] = await db
      .select()
      .from(recalculationRuns)
      .where(eq(recalculationRuns.id, recalcRunId!))
      .limit(1)

    assert.equal(failedRun?.status, 'failed')
    assert.ok(failedRun?.errorDetails)
    assert.ok(failedRun?.completedAt)
    assert.equal(failedRun?.producedEngineRunId, null)
  })

  it('timeline event → invalidateDependencies → schedule → domain event (event-driven entry)', async () => {
    await freshSchema()
    const fixture = await insertEngineEvalFixture(pgClient)
    await insertConfirmedSnapshots(db, fixture)

    const upstreamEventId = randomUUID()
    const correlationId = randomUUID()

    await pgClient.query(
      `INSERT INTO domain_events (
         id, event_type, aggregate_type, aggregate_id,
         correlation_id, organization_id, actor_type, actor_id,
         occurred_at, payload, replayable, processing_status
       ) VALUES ($1, 'timeline.event.appended', 'TimelineEvent', $2,
         $3, $4, 'system', 'test', NOW(), $5::jsonb, TRUE, 'published')`,
      [
        upstreamEventId,
        fixture.timelineEventId,
        correlationId,
        fixture.organizationId,
        JSON.stringify({
          executionCaseId: fixture.executionCaseId,
          timelineEventId: fixture.timelineEventId,
          eventType: 'benefit.granted',
        }),
      ]
    )

    const timelineJob = {
      id: randomUUID(),
      data: {
        eventId: upstreamEventId,
        eventType: 'timeline.event.appended',
        organizationId: fixture.organizationId,
        correlationId,
        payload: {
          executionCaseId: fixture.executionCaseId,
          timelineEventId: fixture.timelineEventId,
          eventType: 'benefit.granted',
        },
      },
    }

    await handleTimelineEventForEngine(db, timelineJob as import('pg-boss').Job<unknown>)

    const [scheduledRun] = await db
      .select()
      .from(recalculationRuns)
      .where(
        and(
          eq(recalculationRuns.executionCaseId, fixture.executionCaseId),
          eq(recalculationRuns.triggerEntityId, fixture.timelineEventId)
        )
      )
      .limit(1)

    assert.equal(scheduledRun?.status, 'scheduled')

    const [evalEvent] = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, 'engine.evaluation.requested'),
          eq(domainEvents.aggregateId, scheduledRun!.id)
        )
      )
      .limit(1)

    assert.ok(evalEvent)
    assert.equal(evalEvent.causationId, upstreamEventId)
    assert.equal(evalEvent.correlationId, correlationId)
  })

  it('idempotent worker delivery skips terminal recalculation runs', async () => {
    await freshSchema()
    const fixture = await insertEngineEvalFixture(pgClient)
    await insertConfirmedSnapshots(db, fixture)

    const correlationId = randomUUID()
    const recalcRunId = await scheduleRecalculation(db, {
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      triggerEntityType: 'timeline_event',
      triggerEntityId: fixture.timelineEventId,
      triggerReason: 'idempotency test',
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
      causationId: null,
    })

    const [evalEvent] = await db
      .select({ id: domainEvents.id, payload: domainEvents.payload })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, recalcRunId!))
      .limit(1)

    const job = buildEvaluationRequestedJob({
      eventId: evalEvent!.id,
      organizationId: fixture.organizationId,
      correlationId,
      causationId: null,
      payload: evalEvent!.payload as Record<string, unknown>,
    })

    await handleEngineEvaluationRequested(db, job as import('pg-boss').Job<unknown>)

    const runsBefore = await db
      .select({ id: engineRuns.id })
      .from(engineRuns)
      .where(eq(engineRuns.executionCaseId, fixture.executionCaseId))

    await handleEngineEvaluationRequested(db, job as import('pg-boss').Job<unknown>)

    const runsAfter = await db
      .select({ id: engineRuns.id })
      .from(engineRuns)
      .where(eq(engineRuns.executionCaseId, fixture.executionCaseId))

    assert.equal(runsAfter.length, runsBefore.length, 'duplicate delivery must not create second EngineRun')
  })
})

describeWithDb('invalidateDependencies integration', () => {
  let pool: pg.Pool
  let pgClient: pg.PoolClient
  let db: ReturnType<typeof createWorkersDb>

  before(async () => {
    pool = createMigrationTestPool(databaseUrl!)
    pgClient = await pool.connect()
    db = createWorkersDb(databaseUrl!)
  })

  after(async () => {
    pgClient.release()
    await pool.end()
  })

  it('invalidateDependencies marks snapshot_dependencies stale', async () => {
    await resetPublicSchema(pgClient)
    await pgClient.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    await applyMigrationFiles(pgClient, ALL_CURRENT_MIGRATIONS)

    const fixture = await insertEngineEvalFixture(pgClient)
    await insertConfirmedSnapshots(db, fixture)

    const affected = await invalidateDependencies(db, {
      dependencyType: 'timeline_event',
      dependencyEntityId: fixture.timelineEventId,
      changeReason: 'test invalidation',
    })

    assert.ok(Array.isArray(affected))
  })
})
