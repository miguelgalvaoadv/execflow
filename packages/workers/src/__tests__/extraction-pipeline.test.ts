/**
 * Extraction pipeline — integration tests.
 *
 * Run: pnpm --filter @execflow/workers test:extraction
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
  extractionRuns,
  documentExtractionResults,
  domainEvents,
  queueProjections,
} from '@execflow/db/schema'
import {
  OCR_COMPLETED,
  EXTRACTION_REQUESTED,
  EXTRACTION_RUNNING,
  EXTRACTION_REVIEW,
  EXTRACTION_CONFIRMED,
  EXTRACTION_FAILED,
  DOCUMENT_CONFIRMED,
} from '@execflow/db/types'
import { assertDocumentExtractionResultRow } from '@execflow/db/types'
import { createMockOcrProvider } from '@execflow/ocr'
import { createMockExtractionProvider } from '@execflow/extraction'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_CURRENT_MIGRATIONS,
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
import {
  handleOcrCompletedForExtraction,
  handleExtractionRequested,
  setExtractionProviderForTests,
  resetExtractionProviderForTests,
} from '../consumers/extraction-events.ts'
import { confirmExtractionRun } from '../extraction/runner.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

type DocFixture = {
  organizationId: string
  documentId: string
  userId: string
}

async function insertDocument(client: pg.PoolClient): Promise<DocFixture> {
  const organizationId = randomUUID()
  const userId = randomUUID()
  const documentId = randomUUID()

  await client.query(
    `INSERT INTO organizations (id, slug, name, status) VALUES ($1, $2, $3, 'active')`,
    [organizationId, `ext-org-${organizationId.slice(0, 8)}`, 'Extraction Test Org']
  )
  await client.query(
    `INSERT INTO users (id, email, display_name, status) VALUES ($1, $2, $3, 'active')`,
    [userId, `ext-${userId.slice(0, 8)}@execflow.test`, 'Extraction Test User']
  )
  await client.query(
    `INSERT INTO documents (
       id, organization_id, storage_key, checksum_sha256, mime_type, file_name, byte_size,
       status, source_channel, ocr_status, sensitivity_level, document_class,
       uploaded_at, uploaded_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, repeat('b', 64), 'application/pdf', 'sentenca.pdf', 1200,
       'pending_extraction', 'intake_pdf', 'pending', 'standard', 'sentenca',
       NOW(), $4, NOW(), NOW()
     )`,
    [documentId, organizationId, `${organizationId}/2026/01/${documentId}.pdf`, userId]
  )

  return { organizationId, documentId, userId }
}

async function runOcrToCompletion(
  db: ReturnType<typeof createWorkersDb>,
  fixture: DocFixture
): Promise<{ ocrRunId: string; ocrResultId: string; ocrCompletedEventId: string }> {
  const regEventId = randomUUID()
  await handleDocumentRegisteredForOcr(
    db,
    {
      id: randomUUID(),
      data: {
        eventId: regEventId,
        organizationId: fixture.organizationId,
        correlationId: regEventId,
        payload: { documentId: fixture.documentId, organizationId: fixture.organizationId },
      },
    } as Parameters<typeof handleDocumentRegisteredForOcr>[1]
  )

  const [run] = await db
    .select()
    .from(ocrRuns)
    .where(eq(ocrRuns.documentId, fixture.documentId))

  assert.ok(run)

  const ocrReqEventId = randomUUID()
  await handleOcrRequested(
    db,
    {
      id: randomUUID(),
      data: {
        eventId: ocrReqEventId,
        organizationId: fixture.organizationId,
        correlationId: ocrReqEventId,
        payload: {
          ocrRunId: run!.id,
          documentId: fixture.documentId,
          organizationId: fixture.organizationId,
          providerId: 'mock',
          runNumber: 1,
          attemptNumber: 1,
        },
      },
    } as Parameters<typeof handleOcrRequested>[1]
  )

  const [result] = await db
    .select()
    .from(documentOcrResults)
    .where(eq(documentOcrResults.ocrRunId, run!.id))

  assert.ok(result)

  const ocrCompletedEventId = randomUUID()
  return { ocrRunId: run!.id, ocrResultId: result!.id, ocrCompletedEventId }
}

function ocrCompletedJob(params: {
  eventId: string
  organizationId: string
  ocrRunId: string
  documentId: string
  resultId: string
}) {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      organizationId: params.organizationId,
      correlationId: params.eventId,
      payload: {
        ocrRunId: params.ocrRunId,
        documentId: params.documentId,
        organizationId: params.organizationId,
        providerId: 'mock',
        pageCount: 1,
        resultId: params.resultId,
      },
    },
  }
}

function extractionRequestedJob(params: {
  eventId: string
  organizationId: string
  extractionRunId: string
  documentId: string
  ocrRunId: string
  ocrResultId: string
  attemptNumber?: number
}) {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      organizationId: params.organizationId,
      correlationId: params.eventId,
      payload: {
        extractionRunId: params.extractionRunId,
        documentId: params.documentId,
        organizationId: params.organizationId,
        ocrRunId: params.ocrRunId,
        ocrResultId: params.ocrResultId,
        providerId: 'mock',
        extractionType: 'generic',
        runNumber: 1,
        attemptNumber: params.attemptNumber ?? 1,
      },
    },
  }
}

describeWithDb('Extraction pipeline', () => {
  let pool: pg.Pool
  let pgClient: pg.PoolClient
  let db: ReturnType<typeof createWorkersDb>

  before(async () => {
    pool = createMigrationTestPool(databaseUrl!)
    pgClient = await pool.connect()
    db = createWorkersDb(databaseUrl!)
    process.env['OCR_MAX_ATTEMPTS'] = '3'
    process.env['EXTRACTION_MAX_ATTEMPTS'] = '3'
  })

  after(async () => {
    pgClient.release()
    await pool.end()
    resetOcrProviderForTests()
    resetExtractionProviderForTests()
  })

  beforeEach(async () => {
    await resetPublicSchema(pgClient)
    await applyMigrationFiles(pgClient, ALL_CURRENT_MIGRATIONS)
    resetOcrProviderForTests()
    resetExtractionProviderForTests()
    setOcrProviderForTests(createMockOcrProvider())
    setExtractionProviderForTests(createMockExtractionProvider())
  })

  it('OCR completed schedules extraction.requested', async () => {
    const fixture = await insertDocument(pgClient)
    const { ocrRunId, ocrResultId, ocrCompletedEventId } = await runOcrToCompletion(db, fixture)

    await handleOcrCompletedForExtraction(
      db,
      ocrCompletedJob({
        eventId: ocrCompletedEventId,
        organizationId: fixture.organizationId,
        ocrRunId,
        documentId: fixture.documentId,
        resultId: ocrResultId,
      }) as Parameters<typeof handleOcrCompletedForExtraction>[1]
    )

    const [run] = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.documentId, fixture.documentId))

    assert.ok(run)
    assert.equal(run?.status, 'requested')

    const events = await db
      .select({ eventType: domainEvents.eventType })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, run!.id))

    assert.ok(events.some((e) => e.eventType === EXTRACTION_REQUESTED))
  })

  it('extraction.requested produces review state with structured data and queue projection', async () => {
    const fixture = await insertDocument(pgClient)
    const { ocrRunId, ocrResultId, ocrCompletedEventId } = await runOcrToCompletion(db, fixture)

    await handleOcrCompletedForExtraction(
      db,
      ocrCompletedJob({
        eventId: ocrCompletedEventId,
        organizationId: fixture.organizationId,
        ocrRunId,
        documentId: fixture.documentId,
        resultId: ocrResultId,
      }) as Parameters<typeof handleOcrCompletedForExtraction>[1]
    )

    const [run] = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.documentId, fixture.documentId))
    assert.ok(run)

    await handleExtractionRequested(
      db,
      extractionRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        extractionRunId: run!.id,
        documentId: fixture.documentId,
        ocrRunId,
        ocrResultId,
      }) as Parameters<typeof handleExtractionRequested>[1]
    )

    const [afterRun] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, run!.id))
    assert.equal(afterRun?.status, 'review')

    const [doc] = await db.select().from(documents).where(eq(documents.id, fixture.documentId))
    assert.equal(doc?.status, 'extraction_review')

    const [result] = await db
      .select()
      .from(documentExtractionResults)
      .where(eq(documentExtractionResults.extractionRunId, run!.id))

    assert.ok(result)
    assertDocumentExtractionResultRow(result, 'integration-test')
    assert.match(String((result.structuredData as Record<string, unknown>)['preview']), /mock-ocr/)

    const [projection] = await db
      .select()
      .from(queueProjections)
      .where(
        and(
          eq(queueProjections.entityId, fixture.documentId),
          eq(queueProjections.queueType, 'extraction_review')
        )
      )

    assert.ok(projection)
    assert.equal(projection.status, 'active')

    const events = await db
      .select({ eventType: domainEvents.eventType })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, run!.id))

    const types = events.map((e) => e.eventType)
    assert.ok(types.includes(EXTRACTION_RUNNING))
    assert.ok(types.includes(EXTRACTION_REVIEW))
  })

  it('confirmExtractionRun transitions to confirmed and resolves queue', async () => {
    const fixture = await insertDocument(pgClient)
    const { ocrRunId, ocrResultId, ocrCompletedEventId } = await runOcrToCompletion(db, fixture)

    await handleOcrCompletedForExtraction(
      db,
      ocrCompletedJob({
        eventId: ocrCompletedEventId,
        organizationId: fixture.organizationId,
        ocrRunId,
        documentId: fixture.documentId,
        resultId: ocrResultId,
      }) as Parameters<typeof handleOcrCompletedForExtraction>[1]
    )

    const [run] = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.documentId, fixture.documentId))
    assert.ok(run)

    await handleExtractionRequested(
      db,
      extractionRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        extractionRunId: run!.id,
        documentId: fixture.documentId,
        ocrRunId,
        ocrResultId,
      }) as Parameters<typeof handleExtractionRequested>[1]
    )

    const ok = await confirmExtractionRun(db, {
      extractionRunId: run!.id,
      organizationId: fixture.organizationId,
      confirmedByUserId: fixture.userId,
    })

    assert.equal(ok, true)

    const [confirmedRun] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, run!.id))
    assert.equal(confirmedRun?.status, 'confirmed')
    assert.ok(confirmedRun?.confirmedAt)

    const [doc] = await db.select().from(documents).where(eq(documents.id, fixture.documentId))
    assert.equal(doc?.status, 'confirmed')
    assert.equal(doc?.confirmedByUserId, fixture.userId)

    const [projection] = await db
      .select()
      .from(queueProjections)
      .where(
        and(
          eq(queueProjections.entityId, fixture.documentId),
          eq(queueProjections.queueType, 'extraction_review')
        )
      )

    assert.equal(projection?.status, 'resolved')

    const confirmEvents = await db
      .select({ eventType: domainEvents.eventType })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.aggregateId, run!.id),
          eq(domainEvents.eventType, EXTRACTION_CONFIRMED)
        )
      )

    assert.equal(confirmEvents.length, 1)

    const docConfirmed = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.aggregateId, fixture.documentId),
          eq(domainEvents.eventType, DOCUMENT_CONFIRMED)
        )
      )

    assert.equal(docConfirmed.length, 1)
  })

  it('marks failed after max attempts', async () => {
    process.env['EXTRACTION_MAX_ATTEMPTS'] = '2'
    const fixture = await insertDocument(pgClient)
    const { ocrRunId, ocrResultId, ocrCompletedEventId } = await runOcrToCompletion(db, fixture)

    setExtractionProviderForTests(
      createMockExtractionProvider({ EXTRACTION_MOCK_FAIL_MESSAGE: 'permanent mock failure' })
    )

    await handleOcrCompletedForExtraction(
      db,
      ocrCompletedJob({
        eventId: ocrCompletedEventId,
        organizationId: fixture.organizationId,
        ocrRunId,
        documentId: fixture.documentId,
        resultId: ocrResultId,
      }) as Parameters<typeof handleOcrCompletedForExtraction>[1]
    )

    const [run] = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.documentId, fixture.documentId))
    assert.ok(run)

    for (let attempt = 1; attempt <= 2; attempt++) {
      await handleExtractionRequested(
        db,
        extractionRequestedJob({
          eventId: randomUUID(),
          organizationId: fixture.organizationId,
          extractionRunId: run!.id,
          documentId: fixture.documentId,
          ocrRunId,
          ocrResultId,
          attemptNumber: attempt,
        }) as Parameters<typeof handleExtractionRequested>[1]
      )
    }

    const [failedRun] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, run!.id))
    assert.equal(failedRun?.status, 'failed')

    const failEvents = await db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.aggregateId, run!.id), eq(domainEvents.eventType, EXTRACTION_FAILED))
      )

    assert.ok(failEvents.length >= 1)
  })

  it('ocr.completed handler is idempotent on trigger event', async () => {
    const fixture = await insertDocument(pgClient)
    const { ocrRunId, ocrResultId, ocrCompletedEventId } = await runOcrToCompletion(db, fixture)

    const job = ocrCompletedJob({
      eventId: ocrCompletedEventId,
      organizationId: fixture.organizationId,
      ocrRunId,
      documentId: fixture.documentId,
      resultId: ocrResultId,
    })

    await handleOcrCompletedForExtraction(
      db,
      job as Parameters<typeof handleOcrCompletedForExtraction>[1]
    )
    await handleOcrCompletedForExtraction(
      db,
      job as Parameters<typeof handleOcrCompletedForExtraction>[1]
    )

    const runs = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.documentId, fixture.documentId))

    assert.equal(runs.length, 1)
  })

  it('retries on failure then completes', async () => {
    process.env['EXTRACTION_MAX_ATTEMPTS'] = '3'
    const fixture = await insertDocument(pgClient)
    const { ocrRunId, ocrResultId, ocrCompletedEventId } = await runOcrToCompletion(db, fixture)

    setExtractionProviderForTests(
      createMockExtractionProvider({}, { failDocumentIds: new Set([fixture.documentId]) })
    )

    await handleOcrCompletedForExtraction(
      db,
      ocrCompletedJob({
        eventId: ocrCompletedEventId,
        organizationId: fixture.organizationId,
        ocrRunId,
        documentId: fixture.documentId,
        resultId: ocrResultId,
      }) as Parameters<typeof handleOcrCompletedForExtraction>[1]
    )

    const [run] = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.documentId, fixture.documentId))
    assert.ok(run)

    await handleExtractionRequested(
      db,
      extractionRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        extractionRunId: run!.id,
        documentId: fixture.documentId,
        ocrRunId,
        ocrResultId,
        attemptNumber: 1,
      }) as Parameters<typeof handleExtractionRequested>[1]
    )

    const [afterFail] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, run!.id))
    assert.equal(afterFail?.status, 'requested')
    assert.equal(afterFail?.attemptCount, 1)

    setExtractionProviderForTests(createMockExtractionProvider())

    await handleExtractionRequested(
      db,
      extractionRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        extractionRunId: run!.id,
        documentId: fixture.documentId,
        ocrRunId,
        ocrResultId,
        attemptNumber: 2,
      }) as Parameters<typeof handleExtractionRequested>[1]
    )

    const [completed] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, run!.id))
    assert.equal(completed?.status, 'review')
  })
})
