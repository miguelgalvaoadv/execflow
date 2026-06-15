/**
 * Fixture for Case Workspace read integration tests.
 */

import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { insertSnapshotLifecycleFixture } from './snapshot-lifecycle-fixture.ts'

export type CaseWorkspaceReadFixture = Awaited<
  ReturnType<typeof insertSnapshotLifecycleFixture>
> & {
  assistantUserId: string
  documentId: string
  deadlineId: string
  opportunityId: string
  timelineEventId: string
}

export async function insertCaseWorkspaceReadFixture(
  client: pg.PoolClient
): Promise<CaseWorkspaceReadFixture> {
  const base = await insertSnapshotLifecycleFixture(client)

  const assistantUserId = randomUUID()
  const documentId = randomUUID()
  const deadlineId = randomUUID()
  const opportunityId = randomUUID()
  const timelineEventId = randomUUID()

  await client.query(
    `INSERT INTO users (id, email, display_name, status) VALUES ($1, $2, $3, 'active')`,
    [assistantUserId, `asst-${assistantUserId.slice(0, 8)}@execflow.test`, 'Assistant Reader']
  )

  await client.query(
    `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1, $2, $3, 'assistant', 'active')`,
    [randomUUID(), base.organizationId, assistantUserId]
  )

  await client.query(
    `UPDATE clients SET cpf = '12345678901', rg = 'MG-123', birth_date = '1990-01-15',
            contact_channels = $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify([{ type: 'phone', value: '+5511999999999' }]),
      base.clientId,
    ]
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
      documentId,
      base.organizationId,
      base.clientId,
      base.executionCaseId,
      `${base.organizationId}/docs/${documentId}.pdf`,
      base.userId,
    ]
  )

  await client.query(
    `INSERT INTO timeline_events (
       id, organization_id, execution_case_id, event_type, event_category,
       occurred_at, recorded_at, summary, payload, source, visibility,
       actor_type, actor_id, author_user_id
     ) VALUES (
       $1, $2, $3, 'case.opened', 'system', NOW() - INTERVAL '1 day', NOW(),
       'Caso aberto para execução penal', '{}'::jsonb, 'system_rule', 'internal',
       'user', $4::text, $5
     )`,
    [timelineEventId, base.organizationId, base.executionCaseId, base.userId, base.userId]
  )

  await client.query(
    `INSERT INTO deadlines (
       id, organization_id, execution_case_id, title, due_at, deadline_class,
       origin, priority, status, created_at, created_by_user_id, updated_at
     ) VALUES (
       $1, $2, $3, 'Manifestação sobre execução', NOW() + INTERVAL '7 days',
       'legal', 'manual', 'high', 'open', NOW(), $4, NOW()
     )`,
    [deadlineId, base.organizationId, base.executionCaseId, base.userId]
  )

  await client.query(
    `INSERT INTO opportunities (
       id, organization_id, execution_case_id, opportunity_type, status,
       summary, rationale, confidence_level, detected_at, created_at, created_by_user_id, updated_at
     ) VALUES (
       $1, $2, $3, 'progression', 'suggested',
       'Progressão para semiaberto', 'Fracionamento atingido', 'medium',
       NOW(), NOW(), $4, NOW()
     )`,
    [opportunityId, base.organizationId, base.executionCaseId, base.userId]
  )

  return {
    ...base,
    assistantUserId,
    documentId,
    deadlineId,
    opportunityId,
    timelineEventId,
  }
}
