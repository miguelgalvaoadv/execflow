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

import { eq, and, isNull, or, lt, desc, ilike } from 'drizzle-orm'
import { clients } from '@execflow/db/schema'
import type { Client, NewClient } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams } from '@execflow/db/repositories'

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

export type ClientListItem = {
  id: string
  fullName: string
  displayName: string | null
  internalRef: string | null
  status: string
  responsibleLawyerUserId: string | null
  updatedAt: Date
}

export type ListClientsFilters = {
  status?: string
  q?: string
}

function parseListCursor(cursor: string): { updatedAt: Date; id: string } | null {
  const separator = cursor.lastIndexOf(':')
  if (separator <= 0) return null
  const updatedAtRaw = cursor.slice(0, separator)
  const id = cursor.slice(separator + 1)
  const updatedAt = new Date(updatedAtRaw)
  if (Number.isNaN(updatedAt.getTime()) || id === '') return null
  return { updatedAt, id }
}

function encodeListCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.toISOString()}:${id}`
}

/**
 * Paginated org-scoped client list — updatedAt DESC, id DESC.
 * Text search matches fullName, displayName, internalRef (no CPF in list query).
 */
export async function listClients(
  db: AnyTx,
  organizationId: string,
  filters: ListClientsFilters,
  params: PaginationParams
): Promise<RepositoryResult<{ items: ClientListItem[]; nextCursor: string | null }>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)
    const conditions = [
      eq(clients.organizationId, organizationId),
      isNull(clients.deletedAt),
    ]

    if (filters.status !== undefined) {
      conditions.push(eq(clients.status, filters.status as Client['status']))
    }

    const q = filters.q?.trim()
    if (q !== undefined && q.length > 0) {
      const pattern = `%${q}%`
      conditions.push(
        or(
          ilike(clients.fullName, pattern),
          ilike(clients.displayName, pattern),
          ilike(clients.internalRef, pattern)
        )!
      )
    }

    if (params.cursor !== undefined) {
      const parsed = parseListCursor(params.cursor)
      if (parsed === null) {
        return {
          success: false,
          error: { code: 'CONSTRAINT', message: 'Invalid pagination cursor.' },
        }
      }
      conditions.push(
        or(
          lt(clients.updatedAt, parsed.updatedAt),
          and(eq(clients.updatedAt, parsed.updatedAt), lt(clients.id, parsed.id))
        )!
      )
    }

    const rows = await db
      .select({
        id: clients.id,
        fullName: clients.fullName,
        displayName: clients.displayName,
        internalRef: clients.internalRef,
        status: clients.status,
        responsibleLawyerUserId: clients.responsibleLawyerUserId,
        updatedAt: clients.updatedAt,
      })
      .from(clients)
      .where(and(...conditions))
      .orderBy(desc(clients.updatedAt), desc(clients.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const items: ClientListItem[] = page.map((row: any) => ({
      id: row.id,
      fullName: row.fullName,
      displayName: row.displayName,
      internalRef: row.internalRef,
      status: row.status,
      responsibleLawyerUserId: row.responsibleLawyerUserId,
      updatedAt: row.updatedAt,
    }))

    const nextCursor =
      hasMore && page.length > 0
        ? encodeListCursor(page[page.length - 1]!.updatedAt, page[page.length - 1]!.id)
        : null

    return { success: true, data: { items, nextCursor } }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list clients.', cause: err },
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
 * Update an existing client record.
 * Must be called inside a transaction alongside AuditLog writes.
 */
export async function updateClient(
  tx: DbTransaction,
  organizationId: string,
  clientId: string,
  data: Partial<Omit<Client, 'id' | 'organizationId' | 'createdAt' | 'createdByUserId' | 'deletedAt'>>
): Promise<RepositoryResult<Client>> {
  try {
    const [row] = await tx
      .update(clients)
      .set(data)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } }
    }

    return { success: true, data: row }
  } catch (err: unknown) {
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
      error: { code: 'UNKNOWN', message: 'Failed to update client.', cause: err },
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
