/**
 * Fixture for org document list integration tests.
 */

import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { insertSnapshotLifecycleFixture } from './snapshot-lifecycle-fixture.ts'

export type DocumentListFixture = Awaited<ReturnType<typeof insertSnapshotLifecycleFixture>> & {
  documentIds: [string, string, string]
}

export async function insertDocumentListFixture(client: pg.PoolClient): Promise<DocumentListFixture> {
  const base = await insertSnapshotLifecycleFixture(client)

  const doc1Id = randomUUID()
  const doc2Id = randomUUID()
  const doc3Id = randomUUID()

  await client.query(
    `UPDATE execution_cases SET internal_ref = 'EXE-DOC-001' WHERE id = $1`,
    [base.executionCaseId]
  )

  await client.query(
    `INSERT INTO documents (
       id, organization_id, client_id, execution_case_id, storage_key, checksum_sha256,
       mime_type, file_name, byte_size, status, source_channel, ocr_status,
       sensitivity_level, document_class, uploaded_at, uploaded_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, repeat('a', 64), 'application/pdf', 'sentenca.pdf', 1200,
       'confirmed', 'intake_pdf', 'completed', 'standard', 'sentenca',
       NOW(), $6, NOW(), NOW()
     )`,
    [
      doc1Id,
      base.organizationId,
      base.clientId,
      base.executionCaseId,
      `${base.organizationId}/docs/${doc1Id}.pdf`,
      base.userId,
    ]
  )

  await client.query(
    `INSERT INTO documents (
       id, organization_id, storage_key, checksum_sha256,
       mime_type, file_name, byte_size, status, source_channel, ocr_status,
       sensitivity_level, document_class, uploaded_at, uploaded_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, repeat('c', 64), 'application/pdf', 'guia-prisao.pdf', 800,
       'extraction_review', 'intake_scan', 'completed', 'standard', 'guia',
       NOW(), $4, NOW(), NOW()
     )`,
    [doc2Id, base.organizationId, `${base.organizationId}/docs/${doc2Id}.pdf`, base.userId]
  )

  await client.query(
    `INSERT INTO documents (
       id, organization_id, client_id, execution_case_id, storage_key, checksum_sha256,
       mime_type, file_name, byte_size, status, source_channel, ocr_status,
       sensitivity_level, document_class, uploaded_at, uploaded_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, repeat('d', 64), 'image/jpeg', 'foto-rg.jpg', 400,
       'pending_extraction', 'intake_whatsapp', 'pending', 'sensitive', 'identidade',
       NOW(), $6, NOW(), NOW()
     )`,
    [
      doc3Id,
      base.organizationId,
      base.clientId,
      base.executionCaseId,
      `${base.organizationId}/docs/${doc3Id}.jpg`,
      base.userId,
    ]
  )

  await client.query(`ALTER TABLE documents DISABLE TRIGGER set_documents_updated_at`)
  await client.query(
    `UPDATE documents SET uploaded_at = NOW() - INTERVAL '3 days' WHERE id = $1`,
    [doc1Id]
  )
  await client.query(
    `UPDATE documents SET uploaded_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
    [doc2Id]
  )
  await client.query(
    `UPDATE documents SET uploaded_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
    [doc3Id]
  )
  await client.query(`ALTER TABLE documents ENABLE TRIGGER set_documents_updated_at`)

  return {
    ...base,
    documentIds: [doc1Id, doc2Id, doc3Id],
  }
}
