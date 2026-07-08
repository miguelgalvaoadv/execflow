/**
 * ClientNote service — anotações livres do advogado sobre um cliente.
 *
 * Cada nota é um registro separado (bloquinho de lembretes, não um campo
 * único). Só o autor original pode editar/excluir a própria nota — evita um
 * assistente apagar a observação de outro colega por engano.
 */

import { eq } from 'drizzle-orm'
import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { findClientById } from '../repositories/client.ts'
import {
  listClientNotes as repoListClientNotes,
  insertClientNote,
  updateClientNoteBody,
  deleteClientNoteById,
} from '../repositories/client-note.ts'
import { ok, validationError, notFoundError, forbiddenError, fromRepositoryError } from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from './result.ts'
import type { ClientNote } from '@execflow/db/schema'

async function assertClientInOrg(
  db: WriteContext['db'] | ReadContext['db'],
  organizationId: string,
  clientId: string
): Promise<ServiceResult<void>> {
  const found = await findClientById(db, organizationId, clientId)
  if (!found.success) {
    if (found.error.code === 'NOT_FOUND') return notFoundError('Client not found.')
    return fromRepositoryError(found.error.code, found.error.message, found.error.cause)
  }
  return ok(undefined)
}

export async function listClientNotes(
  ctx: ReadContext,
  clientId: string
): Promise<ServiceResult<ClientNote[]>> {
  const clientCheck = await assertClientInOrg(ctx.db, ctx.organizationId, clientId)
  if (!clientCheck.success) return clientCheck

  const result = await repoListClientNotes(ctx.db, ctx.organizationId, clientId)
  if (!result.success) return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  return ok(result.data)
}

export async function createClientNote(
  ctx: WriteContext,
  clientId: string,
  body: string
): Promise<ServiceResult<ClientNote>> {
  const trimmed = body.trim()
  if (trimmed.length === 0) return validationError('Note body cannot be empty.', 'body')
  if (trimmed.length > 5000) return validationError('Note body must be 5000 characters or fewer.', 'body')

  const clientCheck = await assertClientInOrg(ctx.db, ctx.organizationId, clientId)
  if (!clientCheck.success) return clientCheck

  try {
    const note = await withTx(ctx.db, async (tx) => {
      return unwrapOrThrow(
        await insertClientNote(tx, {
          organizationId: ctx.organizationId,
          clientId,
          body: trimmed,
          createdByUserId: ctx.userId,
        })
      )
    })
    return ok(note)
  } catch (err) {
    return fromRepositoryError('INTERNAL', 'Failed to create client note.', err)
  }
}

export async function updateClientNote(
  ctx: WriteContext,
  clientId: string,
  noteId: string,
  body: string
): Promise<ServiceResult<ClientNote>> {
  const trimmed = body.trim()
  if (trimmed.length === 0) return validationError('Note body cannot be empty.', 'body')
  if (trimmed.length > 5000) return validationError('Note body must be 5000 characters or fewer.', 'body')

  const { clientNotes } = await import('@execflow/db/schema')
  const existing = await ctx.db.query.clientNotes.findFirst({
    where: eq(clientNotes.id, noteId),
  })
  if (!existing || existing.organizationId !== ctx.organizationId || existing.clientId !== clientId) {
    return notFoundError('Client note not found.')
  }
  if (existing.createdByUserId !== ctx.userId) {
    return forbiddenError('Only the note author can edit this note.')
  }

  try {
    const note = await withTx(ctx.db, async (tx) => {
      return unwrapOrThrow(await updateClientNoteBody(tx, ctx.organizationId, noteId, trimmed, ctx.userId))
    })
    return ok(note)
  } catch (err) {
    return fromRepositoryError('INTERNAL', 'Failed to update client note.', err)
  }
}

export async function deleteClientNote(
  ctx: WriteContext,
  clientId: string,
  noteId: string
): Promise<ServiceResult<void>> {
  const { clientNotes } = await import('@execflow/db/schema')
  const existing = await ctx.db.query.clientNotes.findFirst({
    where: eq(clientNotes.id, noteId),
  })
  if (!existing || existing.organizationId !== ctx.organizationId || existing.clientId !== clientId) {
    return notFoundError('Client note not found.')
  }
  if (existing.createdByUserId !== ctx.userId) {
    return forbiddenError('Only the note author can delete this note.')
  }

  try {
    await withTx(ctx.db, async (tx) => {
      unwrapOrThrow(await deleteClientNoteById(tx, ctx.organizationId, noteId))
    })
    return ok(undefined)
  } catch (err) {
    return fromRepositoryError('INTERNAL', 'Failed to delete client note.', err)
  }
}
