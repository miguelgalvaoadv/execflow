/**
 * Upload + storage integration tests.
 *
 * Requires MIGRATION_TEST_DATABASE_URL.
 *
 * Run: pnpm --filter @execflow/api test:uploads
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { eq, and } from '@execflow/db/client'
import { createPoolDbClient } from '@execflow/db/client'
import { auditLogs, documents, domainEvents } from '@execflow/db/schema'
import {
  createLocalStorageProvider,
  resolveStorageConfigFromEnv,
  sha256Hex,
  DEFAULT_ALLOWED_MIME_TYPES,
} from '@execflow/storage'
import type { WriteContext } from '../lib/write-context.ts'
import type { DbClient } from '../lib/db.ts'
import { resetStorageProviderForTests, setStorageProviderForTests } from '../lib/storage.ts'
import { requestUpload, completeUpload, storeUploadBlob } from '../services/upload.ts'
import {
  applyMigrationFiles,
  createMigrationTestPool,
  ALL_MIGRATIONS_THROUGH_0008,
  resetPublicSchema,
  resolveMigrationTestDatabaseUrl,
} from '../../../../packages/db/src/migrations/test-utils/apply-migrations.ts'

const databaseUrl = resolveMigrationTestDatabaseUrl()
const describeWithDb = databaseUrl !== undefined ? describe : describe.skip

type UploadFixture = {
  organizationId: string
  userId: string
  otherOrganizationId: string
}

async function insertUploadFixture(client: pg.PoolClient): Promise<UploadFixture> {
  const organizationId = randomUUID()
  const otherOrganizationId = randomUUID()
  const userId = randomUUID()

  await client.query(
    `INSERT INTO organizations (id, slug, name, status) VALUES ($1, $2, $3, 'active')`,
    [organizationId, `up-org-${organizationId.slice(0, 8)}`, 'Upload Test Org']
  )
  await client.query(
    `INSERT INTO organizations (id, slug, name, status) VALUES ($1, $2, $3, 'active')`,
    [otherOrganizationId, `up-other-${otherOrganizationId.slice(0, 8)}`, 'Other Org']
  )
  await client.query(
    `INSERT INTO users (id, email, display_name, status) VALUES ($1, $2, $3, 'active')`,
    [userId, `up-${userId.slice(0, 8)}@execflow.test`, 'Upload Test User']
  )
  await client.query(
    `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1, $2, $3, 'assistant', 'active')`,
    [randomUUID(), organizationId, userId]
  )

  return { organizationId, userId, otherOrganizationId }
}

function buildCtx(db: DbClient, fixture: UploadFixture, organizationId?: string): WriteContext {
  const requestId = randomUUID()
  const orgId = organizationId ?? fixture.organizationId
  return {
    db,
    actor: {
      actorType: 'user',
      actorId: fixture.userId,
      actorRole: 'assistant',
      impersonatingUserId: null,
      sessionToken: 'test',
      ipAddress: null,
    },
    organizationId: orgId,
    userId: fixture.userId,
    requestId,
    correlationId: requestId,
  }
}

describeWithDb('upload + storage', () => {
  let pool: pg.Pool
  let pgClient: pg.PoolClient
  let db: DbClient
  let storageDir: string

  before(async () => {
    pool = createMigrationTestPool(databaseUrl!)
    pgClient = await pool.connect()
    db = createPoolDbClient(databaseUrl!) as unknown as DbClient
    storageDir = await mkdtemp(path.join(tmpdir(), 'execflow-upload-'))
    process.env['UPLOAD_TOKEN_SECRET'] = 'test-upload-secret-minimum-32-characters!!'
    process.env['STORAGE_PROVIDER'] = 'local'
    process.env['STORAGE_LOCAL_PATH'] = storageDir
    process.env['STORAGE_API_BASE_URL'] = 'http://localhost:3001'
  })

  after(async () => {
    pgClient.release()
    await pool.end()
    await rm(storageDir, { recursive: true, force: true })
    resetStorageProviderForTests()
  })

  beforeEach(async () => {
    await resetPublicSchema(pgClient)
    await applyMigrationFiles(pgClient, ALL_MIGRATIONS_THROUGH_0008)
    resetStorageProviderForTests()
    const config = resolveStorageConfigFromEnv()
    setStorageProviderForTests(
      createLocalStorageProvider({
        basePath: storageDir,
        apiBaseUrl: 'http://localhost:3001',
      }),
      config
    )
  })

  it('requestUpload returns presigned target and audit log', async () => {
    const fixture = await insertUploadFixture(pgClient)
    const ctx = buildCtx(db, fixture)
    const fileBytes = Buffer.from('%PDF-1.4 upload test')
    const checksumSha256 = sha256Hex(fileBytes)

    const result = await requestUpload(ctx, {
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
      byteSize: fileBytes.byteLength,
      checksumSha256,
      sourceChannel: 'intake_pdf',
    })

    assert.equal(result.success, true)
    if (!result.success) return

    assert.ok(result.data.uploadToken)
    assert.ok(result.data.storageKey.startsWith(`${fixture.organizationId}/`))
    assert.equal(result.data.method, 'PUT')

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'Upload'),
          eq(auditLogs.action, 'upload_requested'),
          eq(auditLogs.entityId, result.data.uploadId)
        )
      )
      .limit(1)

    assert.ok(audit)
  })

  it('completeUpload registers document after valid blob + checksum', async () => {
    const fixture = await insertUploadFixture(pgClient)
    const ctx = buildCtx(db, fixture)
    const fileBytes = Buffer.from('%PDF-1.4 valid upload content')
    const checksumSha256 = sha256Hex(fileBytes)

    const requested = await requestUpload(ctx, {
      fileName: 'valid.pdf',
      mimeType: 'application/pdf',
      byteSize: fileBytes.byteLength,
      checksumSha256,
      sourceChannel: 'intake_pdf',
    })
    assert.equal(requested.success, true)
    if (!requested.success) return

    const stored = await storeUploadBlob(requested.data.uploadToken, fileBytes, 'application/pdf')
    assert.equal(stored.success, true)

    const completed = await completeUpload(ctx, {
      uploadToken: requested.data.uploadToken,
    })
    assert.equal(completed.success, true)
    if (!completed.success) return

    assert.equal(completed.data.storageKey, requested.data.storageKey)
    assert.equal(completed.data.checksumSha256, checksumSha256)

    const [event] = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, 'document.registered'),
          eq(domainEvents.aggregateId, completed.data.id)
        )
      )
      .limit(1)

    assert.ok(event, 'document.registered must be emitted')
  })

  it('rejects checksum mismatch on complete', async () => {
    const fixture = await insertUploadFixture(pgClient)
    const ctx = buildCtx(db, fixture)
    const declared = sha256Hex(Buffer.from('declared content'))
    const actual = Buffer.from('different bytes on disk')

    const requested = await requestUpload(ctx, {
      fileName: 'mismatch.pdf',
      mimeType: 'application/pdf',
      byteSize: actual.byteLength,
      checksumSha256: declared,
      sourceChannel: 'intake_pdf',
    })
    assert.equal(requested.success, true)
    if (!requested.success) return

    await storeUploadBlob(requested.data.uploadToken, actual, 'application/pdf')

    const completed = await completeUpload(ctx, { uploadToken: requested.data.uploadToken })
    assert.equal(completed.success, false)
    if (completed.success) return
    assert.equal(completed.error.code, 'VALIDATION')
    assert.match(completed.error.message, /checksum/i)
  })

  it('rejects cross-organization complete', async () => {
    const fixture = await insertUploadFixture(pgClient)
    const ctx = buildCtx(db, fixture)
    const fileBytes = Buffer.from('cross org test')
    const checksumSha256 = sha256Hex(fileBytes)

    const requested = await requestUpload(ctx, {
      fileName: 'cross.pdf',
      mimeType: 'application/pdf',
      byteSize: fileBytes.byteLength,
      checksumSha256,
      sourceChannel: 'intake_pdf',
    })
    assert.equal(requested.success, true)
    if (!requested.success) return

    await storeUploadBlob(requested.data.uploadToken, fileBytes, 'application/pdf')

    const otherCtx = buildCtx(db, fixture, fixture.otherOrganizationId)
    const completed = await completeUpload(otherCtx, {
      uploadToken: requested.data.uploadToken,
    })

    assert.equal(completed.success, false)
    if (completed.success) return
    assert.equal(completed.error.code, 'FORBIDDEN')
  })

  it('rejects disallowed mime type on request', async () => {
    const fixture = await insertUploadFixture(pgClient)
    const ctx = buildCtx(db, fixture)

    const result = await requestUpload(ctx, {
      fileName: 'virus.exe',
      mimeType: 'application/x-msdownload',
      byteSize: 100,
      checksumSha256: sha256Hex(Buffer.alloc(100)),
      sourceChannel: 'intake_manual',
    })

    assert.equal(result.success, false)
    if (result.success) return
    assert.equal(result.error.code, 'VALIDATION')
    assert.match(result.error.message, /MIME/i)
  })

  it('allowed mime types include legal document formats', () => {
    assert.ok(DEFAULT_ALLOWED_MIME_TYPES.includes('application/pdf'))
  })

  it('prevents duplicate registration of same storage key', async () => {
    const fixture = await insertUploadFixture(pgClient)
    const ctx = buildCtx(db, fixture)
    const fileBytes = Buffer.from('duplicate registration test')
    const checksumSha256 = sha256Hex(fileBytes)

    const requested = await requestUpload(ctx, {
      fileName: 'dup.pdf',
      mimeType: 'application/pdf',
      byteSize: fileBytes.byteLength,
      checksumSha256,
      sourceChannel: 'intake_pdf',
    })
    assert.equal(requested.success, true)
    if (!requested.success) return

    await storeUploadBlob(requested.data.uploadToken, fileBytes, 'application/pdf')

    const first = await completeUpload(ctx, { uploadToken: requested.data.uploadToken })
    assert.equal(first.success, true)

    const second = await completeUpload(ctx, { uploadToken: requested.data.uploadToken })
    assert.equal(second.success, false)
    if (second.success) return
    assert.match(second.error.message, /already been registered/i)

    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.storageKey, requested.data.storageKey))

    assert.equal(rows.length, 1)
  })
})
