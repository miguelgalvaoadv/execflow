/**
 * Snapshot promotion pipeline — integration tests (document → snapshot → engine).
 *
 * Run: pnpm --filter @execflow/workers test:snapshot-promotion
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { eq, and } from '@execflow/db/client'
import {
  documents,
  extractionRuns,
  documentExtractionResults,
  snapshotPromotions,
  sentenceSnapshots,
  domainEvents,
  recalculationRuns,
  engineRuns,
  custodySnapshots,
} from '@execflow/db/schema'
import {
  SNAPSHOT_PROMOTION_REQUESTED,
  SNAPSHOT_PROPOSED,
  SNAPSHOT_CONFIRMED,
  DOCUMENT_CONFIRMED,
} from '@execflow/db/types'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0012,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../db/src/migrations/test-utils/apply-migrations.ts'
import { createWorkersDb } from '../lib/db.ts'
import {
  handleDocumentConfirmedForSnapshotPromotion,
  handleSnapshotPromotionRequested,
} from '../consumers/snapshot-promotion-events.ts'
import { confirmPromotedSnapshot } from '../snapshot-promotion/runner.ts'
import { handleSnapshotConfirmed, handleEngineEvaluationRequested } from '../consumers/engine-events.ts'
import {
  insertEngineEvalFixture,
  buildEvaluationRequestedJob,
} from './fixtures/engine-eval-fixture.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

type PromotionFixture = {
  organizationId: string
  userId: string
  executionCaseId: string
  documentId: string
  extractionRunId: string
}

async function insertConfirmedExtractionDocument(
  client: pg.PoolClient,
  engineFixture: Awaited<ReturnType<typeof insertEngineEvalFixture>>
): Promise<PromotionFixture> {
  const documentId = randomUUID()
  const extractionRunId = randomUUID()
  const ocrRunId = randomUUID()
  const resultId = randomUUID()

  await client.query(
    `INSERT INTO documents (
       id, organization_id, client_id, execution_case_id, storage_key, checksum_sha256,
       mime_type, file_name, byte_size, status, source_channel, ocr_status,
       sensitivity_level, document_class, confirmed_at, confirmed_by_user_id,
       uploaded_at, uploaded_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, repeat('c', 64), 'application/pdf', 'sentenca.pdf', 900,
       'confirmed', 'intake_pdf', 'completed', 'standard', 'sentenca', NOW(), $6,
       NOW(), $6, NOW(), NOW()
     )`,
    [
      documentId,
      engineFixture.organizationId,
      engineFixture.clientId,
      engineFixture.executionCaseId,
      `${engineFixture.organizationId}/2026/01/${documentId}.pdf`,
      engineFixture.userId,
    ]
  )

  await client.query(
    `INSERT INTO ocr_runs (
       id, organization_id, document_id, run_number, status, provider_id,
       attempt_count, max_attempts, completed_at
     ) VALUES ($1, $2, $3, 1, 'completed', 'mock', 1, 3, NOW())`,
    [ocrRunId, engineFixture.organizationId, documentId]
  )

  await client.query(
    `INSERT INTO document_ocr_results (
       id, organization_id, document_id, ocr_run_id, provider_id, raw_text,
       page_count, extracted_at
     ) VALUES ($1, $2, $3, $4, 'mock', '[mock-ocr]', 1, NOW())`,
    [resultId, engineFixture.organizationId, documentId, ocrRunId]
  )

  await client.query(
    `INSERT INTO extraction_runs (
       id, organization_id, document_id, ocr_run_id, ocr_result_id, run_number,
       status, extraction_type, provider_id, attempt_count, max_attempts, completed_at,
       confirmed_at, confirmed_by_user_id
     ) VALUES (
       $1, $2, $3, $4, $5, 1, 'confirmed', 'generic', 'mock', 1, 3, NOW(), NOW(), $6
     )`,
    [
      extractionRunId,
      engineFixture.organizationId,
      documentId,
      ocrRunId,
      resultId,
      engineFixture.userId,
    ]
  )

  await client.query(
    `INSERT INTO document_extraction_results (
       id, organization_id, document_id, extraction_run_id, extraction_type,
       structured_data, confidence, extracted_at
     ) VALUES (
       $1, $2, $3, $4, 'generic',
       $5::jsonb, 'medium', NOW()
     )`,
    [
      randomUUID(),
      engineFixture.organizationId,
      documentId,
      extractionRunId,
      JSON.stringify({
        sentence: {
          totalSentenceDays: 4000,
          servedDays: 800,
          remissionDays: 0,
          detractionDays: 0,
          confidence: 'medium',
        },
      }),
    ]
  )

  return {
    organizationId: engineFixture.organizationId,
    userId: engineFixture.userId,
    executionCaseId: engineFixture.executionCaseId,
    documentId,
    extractionRunId,
  }
}

function documentConfirmedJob(params: {
  eventId: string
  organizationId: string
  documentId: string
  confirmedByUserId: string
  previousStatus?: string
}) {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      organizationId: params.organizationId,
      correlationId: params.eventId,
      payload: {
        documentId: params.documentId,
        organizationId: params.organizationId,
        previousStatus: params.previousStatus ?? 'extraction_review',
        status: 'confirmed',
        confirmedByUserId: params.confirmedByUserId,
      },
    },
  }
}

function promotionRequestedJob(params: {
  eventId: string
  organizationId: string
  promotionId: string
  sourceDocumentId: string
  extractionRunId: string
  executionCaseId: string
}) {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      organizationId: params.organizationId,
      correlationId: params.eventId,
      payload: {
        promotionId: params.promotionId,
        sourceDocumentId: params.sourceDocumentId,
        extractionRunId: params.extractionRunId,
        executionCaseId: params.executionCaseId,
        organizationId: params.organizationId,
        snapshotKind: 'sentence',
        extractionType: 'generic',
      },
    },
  }
}

function snapshotConfirmedJob(params: {
  eventId: string
  organizationId: string
  snapshotId: string
  executionCaseId: string
  confirmedByUserId: string
  promotionId: string
}) {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      organizationId: params.organizationId,
      correlationId: params.eventId,
      payload: {
        snapshotId: params.snapshotId,
        snapshotKind: 'sentence',
        executionCaseId: params.executionCaseId,
        organizationId: params.organizationId,
        confirmedByUserId: params.confirmedByUserId,
        promotionId: params.promotionId,
        status: 'confirmed',
      },
    },
  }
}

describeWithDb('Snapshot promotion pipeline', () => {
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

  beforeEach(async () => {
    await resetPublicSchema(pgClient)
    await applyMigrationFiles(pgClient, ALL_MIGRATIONS_THROUGH_0012)
  })

  it('document.confirmed schedules snapshot.promotion.requested', async () => {
    const engineFixture = await insertEngineEvalFixture(pgClient)
    const fixture = await insertConfirmedExtractionDocument(pgClient, engineFixture)
    const eventId = randomUUID()

    await handleDocumentConfirmedForSnapshotPromotion(
      db,
      documentConfirmedJob({
        eventId,
        organizationId: fixture.organizationId,
        documentId: fixture.documentId,
        confirmedByUserId: fixture.userId,
      }) as Parameters<typeof handleDocumentConfirmedForSnapshotPromotion>[1]
    )

    const [promotion] = await db
      .select()
      .from(snapshotPromotions)
      .where(eq(snapshotPromotions.sourceDocumentId, fixture.documentId))

    assert.ok(promotion)
    assert.equal(promotion?.status, 'requested')
    assert.equal(promotion?.snapshotKind, 'sentence')

    const events = await db
      .select({ eventType: domainEvents.eventType })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, promotion!.id))

    assert.ok(events.some((e) => e.eventType === SNAPSHOT_PROMOTION_REQUESTED))
  })

  it('promotion requested proposes sentence snapshot with snapshot.proposed', async () => {
    const engineFixture = await insertEngineEvalFixture(pgClient)
    const fixture = await insertConfirmedExtractionDocument(pgClient, engineFixture)
    const docEventId = randomUUID()

    await handleDocumentConfirmedForSnapshotPromotion(
      db,
      documentConfirmedJob({
        eventId: docEventId,
        organizationId: fixture.organizationId,
        documentId: fixture.documentId,
        confirmedByUserId: fixture.userId,
      }) as Parameters<typeof handleDocumentConfirmedForSnapshotPromotion>[1]
    )

    const [promotion] = await db
      .select()
      .from(snapshotPromotions)
      .where(eq(snapshotPromotions.sourceDocumentId, fixture.documentId))
    assert.ok(promotion)

    await handleSnapshotPromotionRequested(
      db,
      promotionRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        promotionId: promotion!.id,
        sourceDocumentId: fixture.documentId,
        extractionRunId: fixture.extractionRunId,
        executionCaseId: fixture.executionCaseId,
      }) as Parameters<typeof handleSnapshotPromotionRequested>[1]
    )

    const [after] = await db
      .select()
      .from(snapshotPromotions)
      .where(eq(snapshotPromotions.id, promotion!.id))
    assert.equal(after?.status, 'proposed')
    assert.ok(after?.snapshotId)

    const [snapshot] = await db
      .select()
      .from(sentenceSnapshots)
      .where(eq(sentenceSnapshots.id, after!.snapshotId!))
    assert.equal(snapshot?.status, 'proposed')
    assert.equal(snapshot?.totalSentenceDays, 4000)
    assert.equal(snapshot?.servedDays, 800)

    const proposedEvents = await db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.aggregateId, promotion!.id), eq(domainEvents.eventType, SNAPSHOT_PROPOSED))
      )
    assert.equal(proposedEvents.length, 1)
  })

  it('full chain: confirm snapshot → engine recalculation → evaluation', async () => {
    const engineFixture = await insertEngineEvalFixture(pgClient)
    const fixture = await insertConfirmedExtractionDocument(pgClient, engineFixture)

    await handleDocumentConfirmedForSnapshotPromotion(
      db,
      documentConfirmedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        documentId: fixture.documentId,
        confirmedByUserId: fixture.userId,
      }) as Parameters<typeof handleDocumentConfirmedForSnapshotPromotion>[1]
    )

    const [promotion] = await db
      .select()
      .from(snapshotPromotions)
      .where(eq(snapshotPromotions.sourceDocumentId, fixture.documentId))
    assert.ok(promotion)

    await handleSnapshotPromotionRequested(
      db,
      promotionRequestedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        promotionId: promotion!.id,
        sourceDocumentId: fixture.documentId,
        extractionRunId: fixture.extractionRunId,
        executionCaseId: fixture.executionCaseId,
      }) as Parameters<typeof handleSnapshotPromotionRequested>[1]
    )

    const [proposed] = await db
      .select()
      .from(snapshotPromotions)
      .where(eq(snapshotPromotions.id, promotion!.id))
    assert.ok(proposed?.snapshotId)

    const ok = await confirmPromotedSnapshot(db, {
      promotionId: promotion!.id,
      organizationId: fixture.organizationId,
      confirmedByUserId: fixture.userId,
    })
    assert.equal(ok, true)

    const evaluatedAt = new Date()
    const snapshotEffectiveAt = new Date(evaluatedAt.getTime() - 24 * 60 * 60 * 1000)
    await db.insert(custodySnapshots).values({
      organizationId: fixture.organizationId,
      executionCaseId: fixture.executionCaseId,
      regime: 'fechado',
      effectiveAt: snapshotEffectiveAt,
      confidence: 'high',
      confirmedByUserId: fixture.userId,
      confirmedAt: evaluatedAt,
    })

    const [confirmedSnapshot] = await db
      .select()
      .from(sentenceSnapshots)
      .where(eq(sentenceSnapshots.id, proposed!.snapshotId!))
    assert.equal(confirmedSnapshot?.status, 'confirmed')

    const confirmEvents = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, SNAPSHOT_CONFIRMED),
          eq(domainEvents.aggregateId, proposed!.snapshotId!)
        )
      )
    assert.equal(confirmEvents.length, 1)

    await handleSnapshotConfirmed(
      db,
      snapshotConfirmedJob({
        eventId: randomUUID(),
        organizationId: fixture.organizationId,
        snapshotId: proposed!.snapshotId!,
        executionCaseId: fixture.executionCaseId,
        confirmedByUserId: fixture.userId,
        promotionId: promotion!.id,
      }) as Parameters<typeof handleSnapshotConfirmed>[1]
    )

    const [recalc] = await db
      .select()
      .from(recalculationRuns)
      .where(eq(recalculationRuns.executionCaseId, fixture.executionCaseId))
    assert.ok(recalc)
    assert.equal(recalc?.status, 'scheduled')

    const [evalEvent] = await db
      .select({ id: domainEvents.id, payload: domainEvents.payload })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, recalc!.id))
      .limit(1)
    assert.ok(evalEvent)

    await handleEngineEvaluationRequested(
      db,
      buildEvaluationRequestedJob({
        eventId: evalEvent.id,
        organizationId: fixture.organizationId,
        correlationId: randomUUID(),
        causationId: evalEvent.id,
        payload: evalEvent.payload as Record<string, unknown>,
      }) as Parameters<typeof handleEngineEvaluationRequested>[1]
    )

    const [completedRecalc] = await db
      .select()
      .from(recalculationRuns)
      .where(eq(recalculationRuns.id, recalc!.id))
    assert.equal(completedRecalc?.status, 'completed')
    assert.ok(completedRecalc?.producedEngineRunId)

    const runs = await db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.executionCaseId, fixture.executionCaseId))
    assert.ok(runs.length >= 1)
  })

  it('document.confirmed promotion is idempotent on trigger event', async () => {
    const engineFixture = await insertEngineEvalFixture(pgClient)
    const fixture = await insertConfirmedExtractionDocument(pgClient, engineFixture)
    const eventId = randomUUID()
    const job = documentConfirmedJob({
      eventId,
      organizationId: fixture.organizationId,
      documentId: fixture.documentId,
      confirmedByUserId: fixture.userId,
    })

    await handleDocumentConfirmedForSnapshotPromotion(
      db,
      job as Parameters<typeof handleDocumentConfirmedForSnapshotPromotion>[1]
    )
    await handleDocumentConfirmedForSnapshotPromotion(
      db,
      job as Parameters<typeof handleDocumentConfirmedForSnapshotPromotion>[1]
    )

    const promotions = await db
      .select()
      .from(snapshotPromotions)
      .where(eq(snapshotPromotions.sourceDocumentId, fixture.documentId))
    assert.equal(promotions.length, 1)
  })
})
