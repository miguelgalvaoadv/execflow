/**
 * OCR pipeline — integration tests.
 *
 * Run: pnpm --filter @execflow/workers test:ocr
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { eq, and } from '@execflow/db/client'
import {
  documents,
  ocrRuns,
  documentOcrResults,
  domainEvents,
} from '@execflow/db/schema'
import {
  OCR_REQUESTED,
  OCR_RUNNING,
  OCR_COMPLETED,
  OCR_FAILED,
  DOCUMENT_REGISTERED,
} from '@execflow/db/types'
import { createMockOcrProvider } from '@execflow/ocr'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0009,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../db/src/migrations/test-utils/apply-migrations.ts'
import { createWorkersDb } from '../lib/db.ts'
import {
  handleDocumentRegisteredForOcr,
  handleOcrRequested,
  setOcrProviderForTests,
  resetOcrProviderForTests,
} from '../consumers/ocr-events.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

type DocFixture = {
  organizationId: string
  documentId: string
}

async function insertDocument(client: pg.PoolClient): Promise<DocFixture> {
  const organizationId = randomUUID()
  const userId = randomUUID()
  const documentId = randomUUID()

  await client.query(
    `INSERT INTO organizations (id, slug, name, status) VALUES ($1, $2, $3, 'active')`,
    [organizationId, `ocr-org-${organizationId.slice(0, 8)}`, 'OCR Test Org']
  )
  await client.query(
    `INSERT INTO users (id, email, display_name, status) VALUES ($1, $2, $3, 'active')`,
    [userId, `ocr-${userId.slice(0, 8)}@execflow.test`, 'OCR Test User']
  )
  await client.query(
    `INSERT INTO documents (
       id, organization_id, storage_key, checksum_sha256, mime_type, file_name, byte_size,
       status, source_channel, ocr_status, sensitivity_level,
       uploaded_at, uploaded_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, repeat('a', 64), 'application/pdf', 'test.pdf', 1200,
       'pending_association', 'intake_pdf', 'pending', 'standard',
       NOW(), $4, NOW(), NOW()
     )`,
    [documentId, organizationId, `${organizationId}/2026/01/${documentId}.pdf`, userId]
  )

  return { organizationId, documentId }
}

function documentRegisteredJob(params: {
  eventId: string
  organizationId: string
  documentId: string
}) {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      eventType: DOCUMENT_REGISTERED,
      organizationId: params.organizationId,
      correlationId: params.eventId,
      causationId: null,
      payload: {
        documentId: params.documentId,
        organizationId: params.organizationId,
        status: 'pending_association',
      },
    },
  }
}

function ocrRequestedJob(params: {
  eventId: string
  organizationId: string
  ocrRunId: string
  documentId: string
  providerId: string
  attemptNumber?: number
}) {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      eventType: OCR_REQUESTED,
      organizationId: params.organizationId,
      correlationId: params.eventId,
      causationId: null,
      payload: {
        ocrRunId: params.ocrRunId,
        documentId: params.documentId,
        organizationId: params.organizationId,
        providerId: params.providerId,
        runNumber: 1,
        attemptNumber: params.attemptNumber ?? 1,
      },
    },
  }
}

describeWithDb('OCR pipeline', () => {
  let pool: pg.Pool
  let pgClient: pg.PoolClient
  let db: ReturnType<typeof createWorkersDb>

  before(async () => {
    pool = createMigrationTestPool(databaseUrl!)
    pgClient = await pool.connect()
    db = createWorkersDb(databaseUrl!)
    process.env['OCR_MAX_ATTEMPTS'] = '3'
  })

  after(async () => {
    pgClient.release()
    await pool.end()
    resetOcrProviderForTests()
  })

  beforeEach(async () => {
    await resetPublicSchema(pgClient)
    await applyMigrationFiles(pgClient, ALL_MIGRATIONS_THROUGH_0009)
    resetOcrProviderForTests()
    setOcrProviderForTests(createMockOcrProvider())
  })

  it('document.registered schedules ocr.requested', async () => {
    const fixture = await insertDocument(pgClient)
    const eventId = randomUUID()

    await handleDocumentRegisteredForOcr(
      db,
      documentRegisteredJob({
        eventId,
        organizationId: fixture.organizationId,
        documentId: fixture.documentId,
      }) as Parameters<typeof handleDocumentRegisteredForOcr>[1]
    )

    const [run] = await db
      .select()
      .from(ocrRuns)
      .where(eq(ocrRuns.documentId, fixture.documentId))
      .limit(1)

    assert.ok(run)
    assert.equal(run.status, 'requested')
    assert.equal(run.triggerEventId, eventId)

    const [event] = await db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.eventType, OCR_REQUESTED), eq(domainEvents.aggregateId, run.id))
      )
      .limit(1)

    assert.ok(event)
  })

  it('ocr.requested completes with persisted raw text', async () => {
    const fixture = await insertDocument(pgClient)
    const regEventId = randomUUID()

    await handleDocumentRegisteredForOcr(
      db,
      documentRegisteredJob({
        eventId: regEventId,
        organizationId: fixture.organizationId,
        documentId: fixture.documentId,
      }) as Parameters<typeof handleDocumentRegisteredForOcr>[1]
    )

    const [run] = await db.select().from(ocrRuns).where(eq(ocrRuns.documentId, fixture.documentId))
    assert.ok(run)

    await handleOcrRequested(
      db,
      ocrRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        ocrRunId: run!.id,
        documentId: fixture.documentId,
        providerId: 'mock',
      }) as Parameters<typeof handleOcrRequested>[1]
    )

    const [completedRun] = await db.select().from(ocrRuns).where(eq(ocrRuns.id, run!.id))
    assert.equal(completedRun?.status, 'completed')

    const [doc] = await db.select().from(documents).where(eq(documents.id, fixture.documentId))
    assert.equal(doc?.ocrStatus, 'completed')

    const [result] = await db
      .select()
      .from(documentOcrResults)
      .where(eq(documentOcrResults.ocrRunId, run!.id))
      .limit(1)

    assert.ok(result)
    assert.match(result.rawText, /\[mock-ocr\]/)

    const events = await db
      .select({ eventType: domainEvents.eventType })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, run!.id))

    const types = events.map((e) => e.eventType)
    assert.ok(types.includes(OCR_RUNNING))
    assert.ok(types.includes(OCR_COMPLETED))
  })

  it('retries on failure then completes', async () => {
    process.env['OCR_MAX_ATTEMPTS'] = '3'
    const fixture = await insertDocument(pgClient)

    setOcrProviderForTests(
      createMockOcrProvider({}, { failDocumentIds: new Set([fixture.documentId]) })
    )

    const regEventId = randomUUID()
    await handleDocumentRegisteredForOcr(
      db,
      documentRegisteredJob({
        eventId: regEventId,
        organizationId: fixture.organizationId,
        documentId: fixture.documentId,
      }) as Parameters<typeof handleDocumentRegisteredForOcr>[1]
    )

    const [run] = await db.select().from(ocrRuns).where(eq(ocrRuns.documentId, fixture.documentId))
    assert.ok(run)

    await handleOcrRequested(
      db,
      ocrRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        ocrRunId: run!.id,
        documentId: fixture.documentId,
        providerId: 'mock',
        attemptNumber: 1,
      }) as Parameters<typeof handleOcrRequested>[1]
    )

    const [afterFail] = await db.select().from(ocrRuns).where(eq(ocrRuns.id, run!.id))
    assert.equal(afterFail?.status, 'requested')
    assert.equal(afterFail?.attemptCount, 1)

    setOcrProviderForTests(createMockOcrProvider())

    await handleOcrRequested(
      db,
      ocrRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        ocrRunId: run!.id,
        documentId: fixture.documentId,
        providerId: 'mock',
        attemptNumber: 2,
      }) as Parameters<typeof handleOcrRequested>[1]
    )

    const [completed] = await db.select().from(ocrRuns).where(eq(ocrRuns.id, run!.id))
    assert.equal(completed?.status, 'completed')
  })

  it('marks failed after max attempts', async () => {
    process.env['OCR_MAX_ATTEMPTS'] = '2'
    const fixture = await insertDocument(pgClient)

    setOcrProviderForTests(
      createMockOcrProvider({ OCR_MOCK_FAIL_MESSAGE: 'permanent mock failure' })
    )

    const regEventId = randomUUID()
    await handleDocumentRegisteredForOcr(
      db,
      documentRegisteredJob({
        eventId: regEventId,
        organizationId: fixture.organizationId,
        documentId: fixture.documentId,
      }) as Parameters<typeof handleDocumentRegisteredForOcr>[1]
    )

    const [run] = await db.select().from(ocrRuns).where(eq(ocrRuns.documentId, fixture.documentId))
    assert.ok(run)

    for (let attempt = 1; attempt <= 2; attempt++) {
      await handleOcrRequested(
        db,
        ocrRequestedJob({
          eventId: randomUUID(),
          organizationId: fixture.organizationId,
          ocrRunId: run!.id,
          documentId: fixture.documentId,
          providerId: 'mock',
          attemptNumber: attempt,
        }) as Parameters<typeof handleOcrRequested>[1]
      )
    }

    const [failedRun] = await db.select().from(ocrRuns).where(eq(ocrRuns.id, run!.id))
    assert.equal(failedRun?.status, 'failed')

    const [doc] = await db.select().from(documents).where(eq(documents.id, fixture.documentId))
    assert.equal(doc?.ocrStatus, 'failed')

    const failEvents = await db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.aggregateId, run!.id), eq(domainEvents.eventType, OCR_FAILED))
      )

    assert.ok(failEvents.length >= 1)
  })

  it('document.registered handler is idempotent on trigger event', async () => {
    const fixture = await insertDocument(pgClient)
    const eventId = randomUUID()
    const job = documentRegisteredJob({
      eventId,
      organizationId: fixture.organizationId,
      documentId: fixture.documentId,
    })

    await handleDocumentRegisteredForOcr(
      db,
      job as Parameters<typeof handleDocumentRegisteredForOcr>[1]
    )
    await handleDocumentRegisteredForOcr(
      db,
      job as Parameters<typeof handleDocumentRegisteredForOcr>[1]
    )

    const runs = await db.select().from(ocrRuns).where(eq(ocrRuns.documentId, fixture.documentId))
    assert.equal(runs.length, 1)
  })

  it('skips OCR for ineligible mime types', async () => {
    const fixture = await insertDocument(pgClient)
    await db
      .update(documents)
      .set({ mimeType: 'application/x-msdownload' })
      .where(eq(documents.id, fixture.documentId))

    await handleDocumentRegisteredForOcr(
      db,
      documentRegisteredJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        documentId: fixture.documentId,
      }) as Parameters<typeof handleDocumentRegisteredForOcr>[1]
    )

    const runs = await db.select().from(ocrRuns).where(eq(ocrRuns.documentId, fixture.documentId))
    assert.equal(runs.length, 0)

    const [doc] = await db.select().from(documents).where(eq(documents.id, fixture.documentId))
    assert.equal(doc?.ocrStatus, 'not_applicable')
  })
})
