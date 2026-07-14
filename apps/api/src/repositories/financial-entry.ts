/**
 * FinancialEntry repository — data access for the financial_entries table.
 *
 * Simple CRUD, no state machine: a manual ledger entry can be freely edited
 * (status/amount/dates/notes) by any org member with access, matching the
 * "sempre editável" requirement of the Financeiro module.
 */

import { and, eq, asc, sql } from 'drizzle-orm'
import { financialEntries } from '@execflow/db/schema'
import type { FinancialEntry, NewFinancialEntry } from '@execflow/db/schema'
import type { AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

export async function listFinancialEntriesByClient(
  db: AnyTx,
  organizationId: string,
  clientId: string
): Promise<RepositoryResult<FinancialEntry[]>> {
  try {
    const rows = await db
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.organizationId, organizationId),
          eq(financialEntries.clientId, clientId)
        )
      )
      .orderBy(
        sql`${financialEntries.status} = 'pending' desc`,
        sql`${financialEntries.dueDate} IS NULL`,
        asc(financialEntries.dueDate),
        asc(financialEntries.createdAt)
      )

    return { success: true, data: rows }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list financial entries.', cause: err },
    }
  }
}

export async function findFinancialEntryById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<FinancialEntry>> {
  try {
    const row = await db.query.financialEntries.findFirst({
      where: and(
        eq(financialEntries.id, id),
        eq(financialEntries.organizationId, organizationId)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Financial entry not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to find financial entry.', cause: err },
    }
  }
}

export async function insertFinancialEntry(
  db: AnyTx,
  data: NewFinancialEntry
): Promise<RepositoryResult<FinancialEntry>> {
  try {
    const rows = await db.insert(financialEntries).values(data).returning()
    const row = rows[0]
    if (!row) {
      return { success: false, error: { code: 'UNKNOWN', message: 'Insert returned no rows.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert financial entry.', cause: err },
    }
  }
}

export async function updateFinancialEntry(
  db: AnyTx,
  organizationId: string,
  id: string,
  data: Partial<NewFinancialEntry>
): Promise<RepositoryResult<FinancialEntry>> {
  try {
    const rows = await db
      .update(financialEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(financialEntries.id, id),
          eq(financialEntries.organizationId, organizationId)
        )
      )
      .returning()

    const row = rows[0]
    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Financial entry not found.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update financial entry.', cause: err },
    }
  }
}
