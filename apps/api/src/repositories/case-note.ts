/**
 * CaseNote repository — data access layer for case_notes.
 *
 * Repository rules (mesmo padrão de client.ts):
 * 1. Toda query é escopada por organizationId.
 * 2. Retorna RepositoryResult<T>, nunca lança.
 * 3. Sem regra de negócio (isso vive no serviço).
 */

import { eq, and, desc } from 'drizzle-orm'
import { caseNotes } from '@execflow/db/schema'
import type { CaseNote, NewCaseNote } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

export async function listCaseNotes(
  db: AnyTx,
  organizationId: string,
  executionCaseId: string
): Promise<RepositoryResult<CaseNote[]>> {
  try {
    const rows = await db.query.caseNotes.findMany({
      where: and(eq(caseNotes.organizationId, organizationId), eq(caseNotes.executionCaseId, executionCaseId)),
      orderBy: [desc(caseNotes.createdAt)],
    })
    return { success: true, data: rows }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to list case notes.', cause: err } }
  }
}

export async function insertCaseNote(
  tx: DbTransaction,
  data: NewCaseNote
): Promise<RepositoryResult<CaseNote>> {
  try {
    const [row] = await tx.insert(caseNotes).values(data).returning()
    if (!row) {
      return { success: false, error: { code: 'UNKNOWN', message: 'Case note insert returned no rows.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to insert case note.', cause: err } }
  }
}

export async function updateCaseNoteBody(
  tx: DbTransaction,
  organizationId: string,
  noteId: string,
  body: string,
  updatedByUserId: string
): Promise<RepositoryResult<CaseNote>> {
  try {
    const [row] = await tx
      .update(caseNotes)
      .set({ body, updatedByUserId, updatedAt: new Date() })
      .where(and(eq(caseNotes.id, noteId), eq(caseNotes.organizationId, organizationId)))
      .returning()
    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Case note not found.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to update case note.', cause: err } }
  }
}

export async function deleteCaseNoteById(
  tx: DbTransaction,
  organizationId: string,
  noteId: string
): Promise<RepositoryResult<void>> {
  try {
    const result = await tx
      .delete(caseNotes)
      .where(and(eq(caseNotes.id, noteId), eq(caseNotes.organizationId, organizationId)))
      .returning({ id: caseNotes.id })
    if (result.length === 0) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Case note not found.' } }
    }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to delete case note.', cause: err } }
  }
}
