/**
 * Client repository — data access layer for the clients table.
 *
 * Repository rules (enforced by code review):
 * 1. Every query is scoped by organizationId — no exceptions.
 * 2. Returns RepositoryResult<T>, never throws.
 * 3. No business logic (role checks, state machine evaluation).
 * 4. Write functions accept DbTransaction (must be inside a transaction).
 * 5. Read functions accept AnyTx (can run inside or outside a transaction).
 *
 * Architecture ref: packages/db/src/repositories/index.ts (base contracts).
 */

import { eq, and, isNull } from 'drizzle-orm'
import { clients } from '@execflow/db/schema'
import type { Client, NewClient } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations (accept AnyTx — can run inside or outside transaction)
// ---------------------------------------------------------------------------

/**
 * Find a client by primary key, scoped to the organization.
 * Returns NOT_FOUND if the client doesn't exist or belongs to a different org.
 * NEVER expose whether a client exists in another org — always return NOT_FOUND.
 */
export async function findClientById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<Client>> {
  try {
    const row = await db.query.clients.findFirst({
      where: and(
        eq(clients.id, id),
        eq(clients.organizationId, organizationId),
        isNull(clients.deletedAt)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query client.', cause: err },
    }
  }
}

/**
 * Find a client by CPF within the organization.
 * Used to detect duplicates before insert (triggers merge workflow when found).
 * Returns null (not NOT_FOUND error) when no match — caller decides what to do.
 */
export async function findClientByCpf(
  db: AnyTx,
  organizationId: string,
  normalizedCpf: string
): Promise<RepositoryResult<Client | null>> {
  try {
    const row = await db.query.clients.findFirst({
      where: and(
        eq(clients.organizationId, organizationId),
        eq(clients.cpf, normalizedCpf),
        isNull(clients.deletedAt)
      ),
    })

    return { success: true, data: row ?? null }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query client by CPF.', cause: err },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations (accept DbTransaction — must be inside a transaction)
// ---------------------------------------------------------------------------

/**
 * Insert a new client record.
 * Must be called inside a transaction alongside AuditLog and DomainEvent writes.
 */
export async function insertClient(
  tx: DbTransaction,
  data: NewClient
): Promise<RepositoryResult<Client>> {
  try {
    const [row] = await tx.insert(clients).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Client insert returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err: unknown) {
    // Check for unique constraint violations (CPF duplicate)
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('clients_org_cpf_unique')) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'A client with this CPF already exists in the organization.',
          cause: err,
        },
      }
    }

    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert client.', cause: err },
    }
  }
}

/**
 * Update the responsible lawyer for a client.
 * Produces an AuditLog entry at the service layer (not here).
 */
export async function updateClientLawyer(
  tx: DbTransaction,
  organizationId: string,
  clientId: string,
  lawyerUserId: string,
  updatedAt: Date
): Promise<RepositoryResult<Client>> {
  try {
    const [row] = await tx
      .update(clients)
      .set({ responsibleLawyerUserId: lawyerUserId, updatedAt })
      .where(
        and(eq(clients.id, clientId), eq(clients.organizationId, organizationId))
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update client lawyer.', cause: err },
    }
  }
}
