/**
 * Document layer event wiring — integration tests.
 *
 * Validates canonical producer payloads → consumer handlers → queue projections.
 *
 * Requires MIGRATION_TEST_DATABASE_URL (disposable PostgreSQL).
 *
 * Run: pnpm --filter @execflow/workers test:document-events
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { eq, and } from '@execflow/db/client'
import { queueProjections, workflowTasks } from '@execflow/db/schema'
import {
  buildDocumentAssociatedPayload,
  buildIntakeRegisteredPayload,
  INTAKE_REGISTERED,
  DOCUMENT_ASSOCIATED,
  DOCUMENT_CONFIRMED,
} from '@execflow/db/types'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0008,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../db/src/migrations/test-utils/apply-migrations.ts'
import { createWorkersDb } from '../lib/db.ts'
import {
  handleIntakeRegistered,
  handleDocumentAssociated,
  handleDocumentConfirmed,
} from '../consumers/intake-events.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

type DocumentLayerFixture = {
  organizationId: string
  userId: string
  clientId: string
  executionCaseId: string
  intakeBundleId: string
  documentId: string
}

async function insertDocumentLayerFixture(client: pg.PoolClient): Promise<DocumentLayerFixture> {
  const organizationId = randomUUID()
  const userId = randomUUID()
  const clientId = randomUUID()
  const executionCaseId = randomUUID()
  const intakeBundleId = randomUUID()
  const documentId = randomUUID()
  const membershipId = randomUUID()

  await client.query(
    `INSERT INTO organizations (id, slug, name, status)
     VALUES ($1, $2, $3, 'active')`,
    [organizationId, `doc-org-${organizationId.slice(0, 8)}`, 'Document Event Test Org']
  )

  await client.query(
    `INSERT INTO users (id, email, display_name, status)
     VALUES ($1, $2, $3, 'active')`,
    [userId, `doc-${userId.slice(0, 8)}@execflow.test`, 'Document Event Test User']
  )

  await client.query(
    `INSERT INTO memberships (id, organization_id, user_id, role, status)
     VALUES ($1, $2, $3, 'assistant', 'active')`,
    [membershipId, organizationId, userId]
  )

  await client.query(
    `INSERT INTO clients (
       id, organization_id, full_name, internal_ref,
       responsible_lawyer_user_id, created_by_user_id, status
     ) VALUES ($1, $2, $3, $4, $5, $5, 'active')`,
    [clientId, organizationId, 'Doc Client', `DC-${clientId.slice(0, 8)}`, userId]
  )

  await client.query(
    `INSERT INTO execution_cases (
       id, organization_id, client_id, internal_ref,
       responsible_lawyer_user_id, opened_at, created_by_user_id, case_status
     ) VALUES ($1, $2, $3, $4, $5, NOW(), $5, 'active')`,
    [executionCaseId, organizationId, clientId, `CASE-${executionCaseId.slice(0, 8)}`, userId]
  )

  await client.query(
    `INSERT INTO intake_bundles (
       id, organization_id, source_channel, received_at, uploader_user_id,
       status, file_count, created_at, updated_at
     ) VALUES ($1, $2, 'intake_manual', NOW(), $3, 'received', 0, NOW(), NOW())`,
    [intakeBundleId, organizationId, userId]
  )

  await client.query(
    `INSERT INTO documents (
       id, organization_id, client_id, execution_case_id, intake_bundle_id,
       storage_key, checksum_sha256, mime_type, file_name, byte_size,
       status, source_channel, ocr_status, sensitivity_level,
       uploaded_at, uploaded_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       'org/test/doc.pdf', repeat('a', 64), 'application/pdf', 'test.pdf', 1024,
       'pending_association', 'intake_manual', 'pending', 'standard',
       NOW(), $6, NOW(), NOW()
     )`,
    [documentId, organizationId, clientId, executionCaseId, intakeBundleId, userId]
  )

  return {
    organizationId,
    userId,
    clientId,
    executionCaseId,
    intakeBundleId,
    documentId,
  }
}

function buildJob(params: {
  eventId: string
  eventType: string
  organizationId: string
  payload: Record<string, unknown>
}) {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      eventType: params.eventType,
      payload: params.payload,
      occurredAt: new Date().toISOString(),
      organizationId: params.organizationId,
      correlationId: randomUUID(),
      causationId: null,
    },
  }
}

describeWithDb('document layer event wiring', () => {
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
    await applyMigrationFiles(pgClient, ALL_MIGRATIONS_THROUGH_0008)
  }

  it('intake.registered creates intake_review queue projection and triage task', async () => {
    await freshSchema()
    const fixture = await insertDocumentLayerFixture(pgClient)
    const eventId = randomUUID()
    const receivedAt = new Date()

    const payload = buildIntakeRegisteredPayload({
      intakeBundleId: fixture.intakeBundleId,
      organizationId: fixture.organizationId,
      sourceChannel: 'intake_manual',
      receivedAt,
      uploaderUserId: fixture.userId,
      ref: 'intake_manual',
      hasMissingFields: false,
      missingFieldCount: 0,
    })

    await handleIntakeRegistered(
      db,
      buildJob({
        eventId,
        eventType: INTAKE_REGISTERED,
        organizationId: fixture.organizationId,
        payload,
      }) as Parameters<typeof handleIntakeRegistered>[1]
    )

    const [projection] = await db
      .select()
      .from(queueProjections)
      .where(
        and(
          eq(queueProjections.organizationId, fixture.organizationId),
          eq(queueProjections.queueType, 'intake_review'),
          eq(queueProjections.entityId, fixture.intakeBundleId)
        )
      )
      .limit(1)

    assert.ok(projection, 'intake_review projection must be created')
    assert.equal(projection.status, 'active')
    assert.equal(projection.entityType, 'IntakeBundle')

    const [task] = await db
      .select()
      .from(workflowTasks)
      .where(eq(workflowTasks.causingEventId, eventId))
      .limit(1)

    assert.ok(task, 'intake triage workflow task must be created')
    assert.equal(task.taskType, 'intake_triage')
  })

  it('document.associated with pending_extraction creates extraction_review projection', async () => {
    await freshSchema()
    const fixture = await insertDocumentLayerFixture(pgClient)
    const eventId = randomUUID()

    const payload = buildDocumentAssociatedPayload({
      documentId: fixture.documentId,
      organizationId: fixture.organizationId,
      clientId: fixture.clientId,
      executionCaseId: fixture.executionCaseId,
      documentClass: 'sentenca',
      previousStatus: 'pending_association',
      status: 'pending_extraction',
    })

    await handleDocumentAssociated(
      db,
      buildJob({
        eventId,
        eventType: DOCUMENT_ASSOCIATED,
        organizationId: fixture.organizationId,
        payload,
      }) as Parameters<typeof handleDocumentAssociated>[1]
    )

    const [projection] = await db
      .select()
      .from(queueProjections)
      .where(
        and(
          eq(queueProjections.organizationId, fixture.organizationId),
          eq(queueProjections.queueType, 'extraction_review'),
          eq(queueProjections.entityId, fixture.documentId)
        )
      )
      .limit(1)

    assert.ok(projection, 'extraction_review projection must be created for pending_extraction')
    assert.equal(projection.status, 'active')
    assert.equal(projection.executionCaseId, fixture.executionCaseId)
  })

  it('document.confirmed resolves extraction_review projection', async () => {
    await freshSchema()
    const fixture = await insertDocumentLayerFixture(pgClient)
    const associateEventId = randomUUID()
    const confirmEventId = randomUUID()

    await handleDocumentAssociated(
      db,
      buildJob({
        eventId: associateEventId,
        eventType: DOCUMENT_ASSOCIATED,
        organizationId: fixture.organizationId,
        payload: buildDocumentAssociatedPayload({
          documentId: fixture.documentId,
          organizationId: fixture.organizationId,
          clientId: fixture.clientId,
          executionCaseId: fixture.executionCaseId,
          documentClass: 'sentenca',
          previousStatus: 'pending_association',
          status: 'pending_extraction',
        }),
      }) as Parameters<typeof handleDocumentAssociated>[1]
    )

    await handleDocumentConfirmed(
      db,
      buildJob({
        eventId: confirmEventId,
        eventType: DOCUMENT_CONFIRMED,
        organizationId: fixture.organizationId,
        payload: {
          documentId: fixture.documentId,
          organizationId: fixture.organizationId,
          previousStatus: 'extraction_review',
          status: 'confirmed',
        },
      }) as Parameters<typeof handleDocumentConfirmed>[1]
    )

    const [projection] = await db
      .select()
      .from(queueProjections)
      .where(
        and(
          eq(queueProjections.organizationId, fixture.organizationId),
          eq(queueProjections.queueType, 'extraction_review'),
          eq(queueProjections.entityId, fixture.documentId)
        )
      )
      .limit(1)

    assert.ok(projection, 'projection row must still exist')
    assert.equal(projection.status, 'resolved')
  })

  it('legacy intake payload bundleId is accepted for replay', async () => {
    await freshSchema()
    const fixture = await insertDocumentLayerFixture(pgClient)
    const eventId = randomUUID()

    await handleIntakeRegistered(
      db,
      buildJob({
        eventId,
        eventType: INTAKE_REGISTERED,
        organizationId: fixture.organizationId,
        payload: {
          bundleId: fixture.intakeBundleId,
          organizationId: fixture.organizationId,
          sourceChannel: 'intake_manual',
          receivedAt: new Date().toISOString(),
        },
      }) as Parameters<typeof handleIntakeRegistered>[1]
    )

    const [projection] = await db
      .select()
      .from(queueProjections)
      .where(
        and(
          eq(queueProjections.queueType, 'intake_review'),
          eq(queueProjections.entityId, fixture.intakeBundleId)
        )
      )
      .limit(1)

    assert.ok(projection, 'legacy bundleId alias must still create projection')
  })
})
