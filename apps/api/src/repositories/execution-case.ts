/**
 * ExecutionCase repository — data access layer for execution_cases table.
 *
 * Repository rules apply (see client.ts for full list).
 *
 * Critical: process number lookup uses a partial unique index
 * (only enforced WHERE execution_process_number IS NOT NULL).
 * Duplicate process numbers within an org are a conflict — triggers merge workflow.
 */

import { eq, and, isNull } from 'drizzle-orm'
import { executionCases } from '@execflow/db/schema'
import type { ExecutionCase, NewExecutionCase } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

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
