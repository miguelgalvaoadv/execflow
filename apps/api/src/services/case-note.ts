/**
 * CaseNote service — anotações livres do advogado sobre um processo (execução).
 *
 * Cada nota é um registro separado (bloquinho de lembretes, não um campo
 * único). Só o autor original pode editar/excluir a própria nota — evita um
 * assistente apagar a observação de outro colega por engano.
 */

import { eq } from 'drizzle-orm'
import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { findCaseById } from '../repositories/execution-case.ts'
import {
  listCaseNotes as repoListCaseNotes,
  insertCaseNote,
  updateCaseNoteBody,
  deleteCaseNoteById,
} from '../repositories/case-note.ts'
import { ok, validationError, notFoundError, forbiddenError, fromRepositoryError } from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from './result.ts'
import type { CaseNote } from '@execflow/db/schema'

async function assertCaseInOrg(
  db: WriteContext['db'] | ReadContext['db'],
  organizationId: string,
  executionCaseId: string
): Promise<ServiceResult<void>> {
  const found = await findCaseById(db, organizationId, executionCaseId)
  if (!found.success) {
    if (found.error.code === 'NOT_FOUND') return notFoundError('Case not found.')
    return fromRepositoryError(found.error.code, found.error.message, found.error.cause)
  }
  return ok(undefined)
}

export async function listCaseNotes(
  ctx: ReadContext,
  executionCaseId: string
): Promise<ServiceResult<CaseNote[]>> {
  const caseCheck = await assertCaseInOrg(ctx.db, ctx.organizationId, executionCaseId)
  if (!caseCheck.success) return caseCheck

  const result = await repoListCaseNotes(ctx.db, ctx.organizationId, executionCaseId)
  if (!result.success) return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  return ok(result.data)
}

export async function createCaseNote(
  ctx: WriteContext,
  executionCaseId: string,
  body: string
): Promise<ServiceResult<CaseNote>> {
  const trimmed = body.trim()
  if (trimmed.length === 0) return validationError('Note body cannot be empty.', 'body')
  if (trimmed.length > 5000) return validationError('Note body must be 5000 characters or fewer.', 'body')

  const caseCheck = await assertCaseInOrg(ctx.db, ctx.organizationId, executionCaseId)
  if (!caseCheck.success) return caseCheck

  try {
    const note = await withTx(ctx.db, async (tx) => {
      return unwrapOrThrow(
        await insertCaseNote(tx, {
          organizationId: ctx.organizationId,
          executionCaseId,
          body: trimmed,
          createdByUserId: ctx.userId,
        })
      )
    })
    return ok(note)
  } catch (err) {
    return fromRepositoryError('INTERNAL', 'Failed to create case note.', err)
  }
}

export async function updateCaseNote(
  ctx: WriteContext,
  executionCaseId: string,
  noteId: string,
  body: string
): Promise<ServiceResult<CaseNote>> {
  const trimmed = body.trim()
  if (trimmed.length === 0) return validationError('Note body cannot be empty.', 'body')
  if (trimmed.length > 5000) return validationError('Note body must be 5000 characters or fewer.', 'body')

  const { caseNotes } = await import('@execflow/db/schema')
  const existing = await ctx.db.query.caseNotes.findFirst({
    where: eq(caseNotes.id, noteId),
  })
  if (!existing || existing.organizationId !== ctx.organizationId || existing.executionCaseId !== executionCaseId) {
    return notFoundError('Case note not found.')
  }
  if (existing.createdByUserId !== ctx.userId) {
    return forbiddenError('Only the note author can edit this note.')
  }

  try {
    const note = await withTx(ctx.db, async (tx) => {
      return unwrapOrThrow(await updateCaseNoteBody(tx, ctx.organizationId, noteId, trimmed, ctx.userId))
    })
    return ok(note)
  } catch (err) {
    return fromRepositoryError('INTERNAL', 'Failed to update case note.', err)
  }
}

export async function deleteCaseNote(
  ctx: WriteContext,
  executionCaseId: string,
  noteId: string
): Promise<ServiceResult<void>> {
  const { caseNotes } = await import('@execflow/db/schema')
  const existing = await ctx.db.query.caseNotes.findFirst({
    where: eq(caseNotes.id, noteId),
  })
  if (!existing || existing.organizationId !== ctx.organizationId || existing.executionCaseId !== executionCaseId) {
    return notFoundError('Case note not found.')
  }
  if (existing.createdByUserId !== ctx.userId) {
    return forbiddenError('Only the note author can delete this note.')
  }

  try {
    await withTx(ctx.db, async (tx) => {
      unwrapOrThrow(await deleteCaseNoteById(tx, ctx.organizationId, noteId))
    })
    return ok(undefined)
  } catch (err) {
    return fromRepositoryError('INTERNAL', 'Failed to delete case note.', err)
  }
}
