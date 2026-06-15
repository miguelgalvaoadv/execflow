/**
 * Review & confirmation layer — integration tests.
 *
 * Run: pnpm --filter @execflow/api test:review
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { eq, and } from '@execflow/db/client'
import { createPoolDbClient } from '@execflow/db/client'
import {
  auditLogs,
  domainEvents,
  reviewDecisions,
  extractionRuns,
  documents,
  sentenceSnapshots,
  queueProjections,
} from '@execflow/db/schema'
import {
  EXTRACTION_CONFIRMED,
  EXTRACTION_REJECTED,
  SNAPSHOT_CONFIRMED,
  SNAPSHOT_REJECTED,
} from '@execflow/db/types'
import type { WriteContext } from '../lib/write-context.ts'
import type { DbClient } from '../lib/db.ts'
import {
  getDocumentExtractionReview,
  confirmExtractionReview,
  rejectExtractionReview,
} from '../services/extraction-review.ts'
import {
  getSnapshotReview,
  confirmSnapshotReview,
  rejectSnapshotReview,
} from '../services/snapshot-review.ts'
import { proposeSentenceSnapshot } from '../services/sentence-snapshot.ts'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0012,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../../packages/db/src/migrations/test-utils/apply-migrations.ts'
import { insertSnapshotLifecycleFixture } from './fixtures/snapshot-lifecycle-fixture.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

function buildTestWriteContext(
  db: DbClient,
  params: { organizationId: string; userId: string; role?: 'assistant' | 'lawyer' }
): WriteContext {
  const requestId = randomUUID()
  return {
    db,
    actor: {
      actorType: 'user',
      actorId: params.userId,
      actorRole: params.role ?? 'lawyer',
      impersonatingUserId: null,
      sessionToken: null,
      ipAddress: '127.0.0.1',
    },
    organizationId: params.organizationId,
    userId: params.userId,
    requestId,
    correlationId: requestId,
  }
}

async function insertExtractionInReview(
  client: pg.PoolClient,
  fixture: Awaited<ReturnType<typeof insertSnapshotLifecycleFixture>>
): Promise<{ documentId: string; extractionRunId: string }> {
  const documentId = randomUUID()
  const extractionRunId = randomUUID()
  const ocrRunId = randomUUID()
  const ocrResultId = randomUUID()

  await client.query(
    `INSERT INTO documents (
       id, organization_id, client_id, execution_case_id, storage_key, checksum_sha256,
       mime_type, file_name, byte_size, status, source_channel, ocr_status,
       sensitivity_level, document_class, uploaded_at, uploaded_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, repeat('d', 64), 'application/pdf', 'doc.pdf', 500,
       'extraction_review', 'intake_pdf', 'completed', 'standard', 'sentenca',
       NOW(), $6, NOW(), NOW()
     )`,
    [
      documentId,
      fixture.organizationId,
      fixture.clientId,
      fixture.executionCaseId,
      `${fixture.organizationId}/review/${documentId}.pdf`,
      fixture.userId,
    ]
  )

  await client.query(
    `INSERT INTO ocr_runs (id, organization_id, document_id, run_number, status, provider_id, attempt_count, max_attempts, completed_at)
     VALUES ($1, $2, $3, 1, 'completed', 'mock', 1, 3, NOW())`,
    [ocrRunId, fixture.organizationId, documentId]
  )

  await client.query(
    `INSERT INTO document_ocr_results (id, organization_id, document_id, ocr_run_id, provider_id, raw_text, page_count, extracted_at)
     VALUES ($1, $2, $3, $4, 'mock', 'text', 1, NOW())`,
    [ocrResultId, fixture.organizationId, documentId, ocrRunId]
  )

  await client.query(
    `INSERT INTO extraction_runs (
       id, organization_id, document_id, ocr_run_id, ocr_result_id, run_number,
       status, extraction_type, provider_id, attempt_count, max_attempts, completed_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'review', 'generic', 'mock', 1, 3, NOW())`,
    [extractionRunId, fixture.organizationId, documentId, ocrRunId, ocrResultId]
  )

  await client.query(
    `INSERT INTO document_extraction_results (
       id, organization_id, document_id, extraction_run_id, extraction_type, structured_data, confidence, extracted_at
     ) VALUES ($1, $2, $3, $4, 'generic', $5::jsonb, 'medium', NOW())`,
    [
      randomUUID(),
      fixture.organizationId,
      documentId,
      extractionRunId,
      JSON.stringify({ sentence: { totalSentenceDays: 2000, servedDays: 100 } }),
    ]
  )

  await client.query(
    `INSERT INTO queue_projections (
       id, organization_id, queue_type, entity_type, entity_id, execution_case_id,
       status, priority, display_title, created_at, updated_at
     ) VALUES ($1, $2, 'extraction_review', 'Document', $3, $4, 'active', 2, 'Review', NOW(), NOW())`,
    [randomUUID(), fixture.organizationId, documentId, fixture.executionCaseId]
  )

  return { documentId, extractionRunId }
}

describeWithDb('Review & confirmation layer', () => {
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

  it('approves extraction with audit trail and resolves queue', async () => {
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const { documentId, extractionRunId } = await insertExtractionInReview(pgClient, fixture)
    const ctx = buildTestWriteContext(db, {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      role: 'assistant',
    })

    const view = await getDocumentExtractionReview(ctx, documentId)
    assert.equal(view.success, true)
    assert.equal(view.data?.extractionRunId, extractionRunId)

    const result = await confirmExtractionReview(ctx, extractionRunId, {
      reason: 'Campos validados pelo assistente.',
    })
    assert.equal(result.success, true)

    const [run] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, extractionRunId))
    assert.equal(run?.status, 'confirmed')

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId))
    assert.equal(doc?.status, 'confirmed')

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, extractionRunId), eq(auditLogs.action, 'confirmed')))
    assert.ok(audits.length >= 1)

    const events = await db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.aggregateId, extractionRunId), eq(domainEvents.eventType, EXTRACTION_CONFIRMED))
      )
    assert.equal(events.length, 1)

    const decisions = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.subjectId, extractionRunId))
    assert.equal(decisions[0]?.decision, 'approved')

    const [projection] = await db
      .select()
      .from(queueProjections)
      .where(
        and(
          eq(queueProjections.entityId, documentId),
          eq(queueProjections.queueType, 'extraction_review')
        )
      )
    assert.equal(projection?.status, 'resolved')
  })

  it('rejects extraction with reason and audit trail', async () => {
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const { documentId, extractionRunId } = await insertExtractionInReview(pgClient, fixture)
    const ctx = buildTestWriteContext(db, {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      role: 'assistant',
    })

    const result = await rejectExtractionReview(ctx, extractionRunId, {
      reason: 'Documento duplicado sem relevância processual.',
    })
    assert.equal(result.success, true)

    const [run] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, extractionRunId))
    assert.equal(run?.status, 'rejected')

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId))
    assert.equal(doc?.status, 'rejected')

    const events = await db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.aggregateId, extractionRunId), eq(domainEvents.eventType, EXTRACTION_REJECTED))
      )
    assert.equal(events.length, 1)
  })

  it('approves snapshot via unified review API', async () => {
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const ctx = buildTestWriteContext(db, fixture)

    const proposed = await proposeSentenceSnapshot(ctx, fixture.executionCaseId, {
      effectiveAt: new Date().toISOString(),
      totalSentenceDays: 1500,
      servedDays: 300,
    })
    assert.equal(proposed.success, true)

    const snapshotId = proposed.data!.id

    await db.insert(queueProjections).values({
      organizationId: fixture.organizationId,
      queueType: 'snapshot_review',
      entityType: 'SentenceSnapshot',
      entityId: snapshotId,
      executionCaseId: fixture.executionCaseId,
      status: 'active',
      priority: 2,
      displayTitle: 'Snapshot review',
    })

    const view = await getSnapshotReview(ctx, snapshotId)
    assert.equal(view.success, true)
    assert.equal(view.data?.status, 'proposed')

    const confirmed = await confirmSnapshotReview(ctx, snapshotId, {
      reason: 'Aritmética conferida com documentos.',
    })
    assert.equal(confirmed.success, true)

    const [snap] = await db.select().from(sentenceSnapshots).where(eq(sentenceSnapshots.id, snapshotId))
    assert.equal(snap?.status, 'confirmed')

    const events = await db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.aggregateId, snapshotId), eq(domainEvents.eventType, SNAPSHOT_CONFIRMED))
      )
    assert.equal(events.length, 1)
  })

  it('rejects proposed snapshot', async () => {
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const ctx = buildTestWriteContext(db, fixture)

    const proposed = await proposeSentenceSnapshot(ctx, fixture.executionCaseId, {
      effectiveAt: new Date().toISOString(),
      totalSentenceDays: 900,
      servedDays: 50,
    })
    assert.equal(proposed.success, true)
    const snapshotId = proposed.data!.id

    const result = await rejectSnapshotReview(ctx, snapshotId, {
      reason: 'Valores inconsistentes com a sentença original.',
    })
    assert.equal(result.success, true)

    const [snap] = await db.select().from(sentenceSnapshots).where(eq(sentenceSnapshots.id, snapshotId))
    assert.equal(snap?.status, 'rejected')

    const events = await db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.aggregateId, snapshotId), eq(domainEvents.eventType, SNAPSHOT_REJECTED))
      )
    assert.equal(events.length, 1)
  })

  it('enforces RBAC: assistant cannot confirm snapshot', async () => {
    const fixture = await insertSnapshotLifecycleFixture(pgClient)
    const assistantId = randomUUID()
    await pgClient.query(
      `INSERT INTO users (id, email, display_name, status) VALUES ($1, $2, $3, 'active')`,
      [assistantId, `asst-${assistantId.slice(0, 8)}@execflow.test`, 'Assistant User']
    )
    await pgClient.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1, $2, $3, 'assistant', 'active')`,
      [randomUUID(), fixture.organizationId, assistantId]
    )

    const lawyerCtx = buildTestWriteContext(db, fixture)
    const proposed = await proposeSentenceSnapshot(lawyerCtx, fixture.executionCaseId, {
      effectiveAt: new Date().toISOString(),
      totalSentenceDays: 800,
    })
    assert.equal(proposed.success, true)

    const assistantCtx = buildTestWriteContext(db, {
      organizationId: fixture.organizationId,
      userId: assistantId,
      role: 'assistant',
    })

    const result = await confirmSnapshotReview(assistantCtx, proposed.data!.id, {
      reason: 'Should not be allowed.',
    })
    assert.equal(result.success, false)
    if (!result.success) {
      assert.match(result.error.message, /Lawyer role required/i)
    }
  })
})
