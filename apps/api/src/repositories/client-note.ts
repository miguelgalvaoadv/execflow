/**
 * ClientNote repository — data access layer for client_notes.
 *
 * Repository rules (mesmo padrão de client.ts):
 * 1. Toda query é escopada por organizationId.
 * 2. Retorna RepositoryResult<T>, nunca lança.
 * 3. Sem regra de negócio (isso vive no serviço).
 */

import { eq, and, desc } from 'drizzle-orm'
import { clientNotes } from '@execflow/db/schema'
import type { ClientNote, NewClientNote } from '@execflow/db/schema'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

export async function listClientNotes(
  db: AnyTx,
  organizationId: string,
  clientId: string
): Promise<RepositoryResult<ClientNote[]>> {
  try {
    const rows = await db.query.clientNotes.findMany({
      where: and(eq(clientNotes.organizationId, organizationId), eq(clientNotes.clientId, clientId)),
      orderBy: [desc(clientNotes.createdAt)],
    })
    return { success: true, data: rows }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to list client notes.', cause: err } }
  }
}

export async function findClientNoteById(
  db: AnyTx,
  organizationId: string,
  noteId: string
): Promise<RepositoryResult<ClientNote>> {
  try {
    const row = await db.query.clientNotes.findFirst({
      where: and(eq(clientNotes.id, noteId), eq(clientNotes.organizationId, organizationId)),
    })
    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Client note not found.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to find client note.', cause: err } }
  }
}

export async function insertClientNote(
  tx: DbTransaction,
  data: NewClientNote
): Promise<RepositoryResult<ClientNote>> {
  try {
    const [row] = await tx.insert(clientNotes).values(data).returning()
    if (!row) {
      return { success: false, error: { code: 'UNKNOWN', message: 'Client note insert returned no rows.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to insert client note.', cause: err } }
  }
}

export async function updateClientNoteBody(
  tx: DbTransaction,
  organizationId: string,
  noteId: string,
  body: string,
  updatedByUserId: string
): Promise<RepositoryResult<ClientNote>> {
  try {
    const [row] = await tx
      .update(clientNotes)
      .set({ body, updatedByUserId, updatedAt: new Date() })
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.organizationId, organizationId)))
      .returning()
    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Client note not found.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to update client note.', cause: err } }
  }
}

export async function deleteClientNoteById(
  tx: DbTransaction,
  organizationId: string,
  noteId: string
): Promise<RepositoryResult<void>> {
  try {
    const result = await tx
      .delete(clientNotes)
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.organizationId, organizationId)))
      .returning({ id: clientNotes.id })
    if (result.length === 0) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Client note not found.' } }
    }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Failed to delete client note.', cause: err } }
  }
}
