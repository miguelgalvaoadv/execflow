/**
 * Fixture for org deadline list integration tests.
 */

import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { insertSnapshotLifecycleFixture } from './snapshot-lifecycle-fixture.ts'

export type DeadlineListFixture = Awaited<ReturnType<typeof insertSnapshotLifecycleFixture>> & {
  deadlineIds: [string, string, string]
}

export async function insertDeadlineListFixture(client: pg.PoolClient): Promise<DeadlineListFixture> {
  const base = await insertSnapshotLifecycleFixture(client)

  const dl1Id = randomUUID()
  const dl2Id = randomUUID()
  const dl3Id = randomUUID()

  await client.query(
    `UPDATE execution_cases SET internal_ref = 'EXE-DL-001' WHERE id = $1`,
    [base.executionCaseId]
  )

  await client.query(
    `INSERT INTO deadlines (
       id, organization_id, execution_case_id, title, due_at, deadline_class,
       origin, priority, status, created_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'Manifestação inicial', NOW() + INTERVAL '1 day', 'legal',
       'manual', 'critical', 'open', $4, NOW(), NOW()
     )`,
    [dl1Id, base.organizationId, base.executionCaseId, base.userId]
  )

  await client.query(
    `INSERT INTO deadlines (
       id, organization_id, execution_case_id, title, due_at, deadline_class,
       origin, priority, status, created_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'Revisão de progressão', NOW() + INTERVAL '5 days', 'benefit',
       'manual', 'high', 'acknowledged', $4, NOW(), NOW()
     )`,
    [dl2Id, base.organizationId, base.executionCaseId, base.userId]
  )

  await client.query(
    `INSERT INTO deadlines (
       id, organization_id, execution_case_id, title, due_at, deadline_class,
       origin, priority, status, created_by_user_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'Prazo vencido teste', NOW() - INTERVAL '2 days', 'legal',
       'manual', 'normal', 'overdue', $4, NOW(), NOW()
     )`,
    [dl3Id, base.organizationId, base.executionCaseId, base.userId]
  )

  await client.query(`ALTER TABLE deadlines DISABLE TRIGGER deadlines_updated_at`)
  await client.query(
    `UPDATE deadlines SET due_at = NOW() + INTERVAL '1 day' WHERE id = $1`,
    [dl1Id]
  )
  await client.query(
    `UPDATE deadlines SET due_at = NOW() + INTERVAL '5 days' WHERE id = $1`,
    [dl2Id]
  )
  await client.query(
    `UPDATE deadlines SET due_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
    [dl3Id]
  )
  await client.query(`ALTER TABLE deadlines ENABLE TRIGGER deadlines_updated_at`)

  return {
    ...base,
    deadlineIds: [dl1Id, dl2Id, dl3Id],
  }
}
