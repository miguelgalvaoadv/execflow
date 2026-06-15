/**
 * Fixture for execution case list integration tests.
 */

import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { insertSnapshotLifecycleFixture } from './snapshot-lifecycle-fixture.ts'

export type CaseListFixture = Awaited<ReturnType<typeof insertSnapshotLifecycleFixture>> & {
  caseIds: [string, string, string]
}

export async function insertCaseListFixture(client: pg.PoolClient): Promise<CaseListFixture> {
  const base = await insertSnapshotLifecycleFixture(client)

  const case2Id = randomUUID()
  const case3Id = randomUUID()

  await client.query(
    `UPDATE execution_cases
     SET internal_ref = 'EXE-001',
         court_jurisdiction = 'São Paulo/SP',
         court_name = '1ª VEP SP',
         case_status = 'intake'
     WHERE id = $1`,
    [base.executionCaseId]
  )

  await client.query(
    `INSERT INTO execution_cases (
       id, organization_id, client_id, internal_ref,
       responsible_lawyer_user_id, opened_at, created_by_user_id, case_status,
       court_jurisdiction, court_name
     ) VALUES (
       $1, $2, $3, 'EXE-002', $4, NOW(), $4, 'active',
       'Campinas/SP', 'VEC Campinas'
     )`,
    [case2Id, base.organizationId, base.clientId, base.userId]
  )

  await client.query(
    `INSERT INTO execution_cases (
       id, organization_id, client_id, internal_ref,
       responsible_lawyer_user_id, opened_at, created_by_user_id, case_status,
       court_jurisdiction, court_name, execution_process_number
     ) VALUES (
       $1, $2, $3, 'EXE-003', $4, NOW(), $4, 'active',
       'São Paulo/SP', '2ª VEP SP', '1234567-89.2024.8.26.0100'
     )`,
    [case3Id, base.organizationId, base.clientId, base.userId]
  )

  // Bypass updated_at trigger to establish deterministic sort order for tests.
  await client.query(`ALTER TABLE execution_cases DISABLE TRIGGER set_execution_cases_updated_at`)
  await client.query(
    `UPDATE execution_cases SET updated_at = NOW() - INTERVAL '3 days' WHERE id = $1`,
    [base.executionCaseId]
  )
  await client.query(
    `UPDATE execution_cases SET updated_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
    [case2Id]
  )
  await client.query(
    `UPDATE execution_cases SET updated_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
    [case3Id]
  )
  await client.query(`ALTER TABLE execution_cases ENABLE TRIGGER set_execution_cases_updated_at`)

  return {
    ...base,
    caseIds: [base.executionCaseId, case2Id, case3Id],
  }
}
