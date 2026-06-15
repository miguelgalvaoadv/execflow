/**
 * ExecutionCase repository — data access layer for execution_cases table.
 *
 * Repository rules apply (see client.ts for full list).
 *
 * Critical: process number lookup uses a partial unique index
 * (only enforced WHERE execution_process_number IS NOT NULL).
 * Duplicate process numbers within an org are a conflict — triggers merge workflow.
 */

import { eq, and, isNull, or, lt, desc, ilike } from 'drizzle-orm'
import { executionCases, clients } from '@execflow/db/schema'
import type { ExecutionCase, NewExecutionCase } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Find an execution case by primary key, scoped to the organization.
 * Soft-deleted cases are excluded (deletedAt IS NULL).
 */
export async function findCaseById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<ExecutionCase>> {
  try {
    const row = await db.query.executionCases.findFirst({
      where: and(
        eq(executionCases.id, id),
        eq(executionCases.organizationId, organizationId),
        isNull(executionCases.deletedAt)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Execution case not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query execution case.', cause: err },
    }
  }
}

export type CaseClientSummary = {
  id: string
  fullName: string
  displayName: string | null
}

export type ExecutionCaseDetail = ExecutionCase & {
  clientSummary: CaseClientSummary
}

export type ExecutionCaseListItem = {
  id: string
  internalRef: string
  executionProcessNumber: string | null
  status: string
  courtName: string | null
  courtJurisdiction: string | null
  updatedAt: Date
  clientSummary: CaseClientSummary
}

export type ListExecutionCasesFilters = {
  status?: string
  courtJurisdiction?: string
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
 * Paginated org-scoped case list — updatedAt DESC, id DESC.
 * Single JOIN with clients (no N+1).
 */
export async function listExecutionCases(
  db: AnyTx,
  organizationId: string,
  filters: ListExecutionCasesFilters,
  params: PaginationParams
): Promise<RepositoryResult<{ items: ExecutionCaseListItem[]; nextCursor: string | null }>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)
    const conditions = [
      eq(executionCases.organizationId, organizationId),
      isNull(executionCases.deletedAt),
      eq(clients.organizationId, organizationId),
      isNull(clients.deletedAt),
    ]

    if (filters.status !== undefined) {
      conditions.push(eq(executionCases.status, filters.status as ExecutionCase['status']))
    }

    if (filters.courtJurisdiction !== undefined) {
      conditions.push(eq(executionCases.courtJurisdiction, filters.courtJurisdiction))
    }

    const q = filters.q?.trim()
    if (q !== undefined && q.length > 0) {
      const pattern = `%${q}%`
      conditions.push(
        or(
          ilike(clients.fullName, pattern),
          ilike(clients.displayName, pattern),
          ilike(executionCases.internalRef, pattern),
          ilike(executionCases.executionProcessNumber, pattern),
          ilike(executionCases.courtName, pattern)
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
          lt(executionCases.updatedAt, parsed.updatedAt),
          and(
            eq(executionCases.updatedAt, parsed.updatedAt),
            lt(executionCases.id, parsed.id)
          )
        )!
      )
    }

    const rows = await db
      .select({
        id: executionCases.id,
        internalRef: executionCases.internalRef,
        executionProcessNumber: executionCases.executionProcessNumber,
        status: executionCases.status,
        courtName: executionCases.courtName,
        courtJurisdiction: executionCases.courtJurisdiction,
        updatedAt: executionCases.updatedAt,
        clientId: clients.id,
        clientFullName: clients.fullName,
        clientDisplayName: clients.displayName,
      })
      .from(executionCases)
      .innerJoin(clients, eq(executionCases.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(desc(executionCases.updatedAt), desc(executionCases.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const items: ExecutionCaseListItem[] = page.map((row: any) => ({
      id: row.id,
      internalRef: row.internalRef,
      executionProcessNumber: row.executionProcessNumber,
      status: row.status,
      courtName: row.courtName,
      courtJurisdiction: row.courtJurisdiction,
      updatedAt: row.updatedAt,
      clientSummary: {
        id: row.clientId,
        fullName: row.clientFullName,
        displayName: row.clientDisplayName,
      },
    }))

    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last !== undefined ? encodeListCursor(last.updatedAt, last.id) : null

    return { success: true, data: { items, nextCursor } }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list execution cases.', cause: err },
    }
  }
}

/**
 * Case detail with embedded client summary (single query — no N+1).
 */
export async function findCaseDetailById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<ExecutionCaseDetail>> {
  try {
    const { clients } = await import('@execflow/db/schema')

    const rows = await db
      .select({
        case: executionCases,
        clientId: clients.id,
        clientFullName: clients.fullName,
        clientDisplayName: clients.displayName,
      })
      .from(executionCases)
      .innerJoin(clients, eq(executionCases.clientId, clients.id))
      .where(
        and(
          eq(executionCases.id, id),
          eq(executionCases.organizationId, organizationId),
          eq(clients.organizationId, organizationId),
          isNull(executionCases.deletedAt),
          isNull(clients.deletedAt)
        )
      )
      .limit(1)

    const row = rows[0]
    if (row === undefined) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Execution case not found.' } }
    }

    return {
      success: true,
      data: {
        ...row.case,
        clientSummary: {
          id: row.clientId,
          fullName: row.clientFullName,
          displayName: row.clientDisplayName,
        },
      },
    }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query execution case detail.', cause: err },
    }
  }
}

/**
 * Find an execution case by process number within the organization.
 * Process number lookup is the primary deduplication check before insert.
 * Returns null (not NOT_FOUND error) when no match.
 */
export async function findCaseByProcessNumber(
  db: AnyTx,
  organizationId: string,
  processNumber: string
): Promise<RepositoryResult<ExecutionCase | null>> {
  try {
    const row = await db.query.executionCases.findFirst({
      where: and(
        eq(executionCases.organizationId, organizationId),
        eq(executionCases.executionProcessNumber, processNumber),
        isNull(executionCases.deletedAt)
      ),
    })

    return { success: true, data: row ?? null }
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN',
        message: 'Failed to query case by process number.',
        cause: err,
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert a new execution case.
 * Must be called inside a transaction alongside AuditLog and DomainEvent writes.
 */
export async function insertCase(
  tx: DbTransaction,
  data: NewExecutionCase
): Promise<RepositoryResult<ExecutionCase>> {
  try {
    const [row] = await tx.insert(executionCases).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Case insert returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)

    if (message.includes('execution_cases_process_number_unique')) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'An execution case with this process number already exists in the organization.',
          cause: err,
        },
      }
    }
    if (message.includes('execution_cases_internal_ref_unique')) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'An execution case with this internal reference already exists.',
          cause: err,
        },
      }
    }

    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert execution case.', cause: err },
    }
  }
}

/**
 * Bind a process number to an existing case (intake → active transition step).
 * Updates execution_process_number and optionally clears process_number_pending_since.
 */
export async function bindProcessNumber(
  tx: DbTransaction,
  organizationId: string,
  caseId: string,
  processNumber: string,
  updatedAt: Date
): Promise<RepositoryResult<ExecutionCase>> {
  try {
    const [row] = await tx
      .update(executionCases)
      .set({
        executionProcessNumber: processNumber,
        processNumberPendingSince: null,
        updatedAt,
      })
      .where(
        and(
          eq(executionCases.id, caseId),
          eq(executionCases.organizationId, organizationId),
          isNull(executionCases.deletedAt)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Execution case not found.' } }
    }

    return { success: true, data: row }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('execution_cases_process_number_unique')) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'This process number is already assigned to another case in the organization.',
          cause: err,
        },
      }
    }
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to bind process number.', cause: err },
    }
  }
}
