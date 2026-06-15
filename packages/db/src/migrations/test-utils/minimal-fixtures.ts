/**
 * Minimal tenant graph for migration trigger tests (0001–0004).
 */

import { randomUUID } from 'node:crypto'
import type pg from 'pg'

export type MinimalTenantIds = {
  organizationId: string
  userId: string
  clientId: string
  executionCaseId: string
}

export async function insertMinimalTenantGraph(
  client: pg.PoolClient
): Promise<MinimalTenantIds> {
  const organizationId = randomUUID()
  const userId = randomUUID()
  const clientId = randomUUID()
  const executionCaseId = randomUUID()
  const membershipId = randomUUID()

  await client.query(
    `INSERT INTO organizations (id, slug, name, status)
     VALUES ($1, $2, $3, 'active')`,
    [organizationId, `test-org-${organizationId.slice(0, 8)}`, 'Migration Test Org']
  )

  await client.query(
    `INSERT INTO users (id, email, display_name, status)
     VALUES ($1, $2, $3, 'active')`,
    [userId, `test-${userId.slice(0, 8)}@execflow.test`, 'Migration Test User']
  )

  await client.query(
    `INSERT INTO memberships (id, organization_id, user_id, role, status)
     VALUES ($1, $2, $3, 'lawyer', 'active')`,
    [membershipId, organizationId, userId]
  )

  await client.query(
    `INSERT INTO clients (
       id, organization_id, full_name, internal_ref,
       responsible_lawyer_user_id, created_by_user_id, status
     ) VALUES ($1, $2, $3, $4, $5, $5, 'active')`,
    [clientId, organizationId, 'Test Client', `REF-${clientId.slice(0, 8)}`, userId]
  )

  await client.query(
    `INSERT INTO execution_cases (
       id, organization_id, client_id, internal_ref,
       responsible_lawyer_user_id, opened_at, created_by_user_id, case_status
     ) VALUES ($1, $2, $3, $4, $5, NOW(), $5, 'intake')`,
    [
      executionCaseId,
      organizationId,
      clientId,
      `CASE-${executionCaseId.slice(0, 8)}`,
      userId,
    ]
  )

  return { organizationId, userId, clientId, executionCaseId }
}
