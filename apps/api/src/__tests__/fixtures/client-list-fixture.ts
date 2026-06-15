/**
 * Fixture for client list integration tests.
 */

import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { insertSnapshotLifecycleFixture } from './snapshot-lifecycle-fixture.ts'

export type ClientListFixture = Awaited<ReturnType<typeof insertSnapshotLifecycleFixture>> & {
  clientIds: [string, string, string]
}

export async function insertClientListFixture(client: pg.PoolClient): Promise<ClientListFixture> {
  const base = await insertSnapshotLifecycleFixture(client)

  const client2Id = randomUUID()
  const client3Id = randomUUID()

  await client.query(
    `UPDATE clients
     SET full_name = 'Snapshot Client',
         display_name = 'Cliente Snapshot',
         internal_ref = 'CLI-001',
         status = 'active'
     WHERE id = $1`,
    [base.clientId]
  )

  await client.query(
    `INSERT INTO clients (
       id, organization_id, full_name, display_name, internal_ref, cpf,
       responsible_lawyer_user_id, created_by_user_id, status
     ) VALUES (
       $1, $2, 'Maria Oliveira', 'Maria O.', 'CLI-002', $4, $3, $3, 'inactive'
     )`,
    [client2Id, base.organizationId, base.userId, `529982247${client2Id.slice(0, 2)}`]
  )

  await client.query(
    `INSERT INTO clients (
       id, organization_id, full_name, internal_ref, cpf,
       responsible_lawyer_user_id, created_by_user_id, status
     ) VALUES (
       $1, $2, 'João Pereira', 'CLI-003', $4, $3, $3, 'active'
     )`,
    [client3Id, base.organizationId, base.userId, `529982247${client3Id.slice(0, 2)}`]
  )

  await client.query(`ALTER TABLE clients DISABLE TRIGGER set_clients_updated_at`)
  await client.query(
    `UPDATE clients SET updated_at = NOW() - INTERVAL '3 days' WHERE id = $1`,
    [base.clientId]
  )
  await client.query(
    `UPDATE clients SET updated_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
    [client2Id]
  )
  await client.query(
    `UPDATE clients SET updated_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
    [client3Id]
  )
  await client.query(`ALTER TABLE clients ENABLE TRIGGER set_clients_updated_at`)

  return {
    ...base,
    clientIds: [base.clientId, client2Id, client3Id],
  }
}
