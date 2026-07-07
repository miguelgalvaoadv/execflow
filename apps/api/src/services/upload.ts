/**
 * Upload service — presigned upload request, checksum verification, document registration.
 *
 * Flow: request → client PUT to storage → complete → document.registered
 *
 * No OCR, extraction, or document reading — physical file + metadata only.
 * Architecture ref: ARCHITECTURE_RULES.md §D-01 (immutable blobs).
 */

import { randomUUID } from 'node:crypto'
import { withTx, unwrapOrThrow } from '../lib/tx.ts'
import { writeAuditLog } from '../repositories/audit.ts'
import { registerDocument } from './document.ts'
import { signUploadToken, verifyUploadToken } from '../lib/upload-token.ts'
import { getStorageConfig, getStorageProvider } from '../lib/storage.ts'
import {
  buildStorageKey,
  assertStorageKeyBelongsToOrg,
  isValidChecksumSha256,
  StorageVerificationError,
} from '@execflow/storage'
import {
  ok,
  validationError,
  forbiddenError,
  notFoundError,
  internalServiceError,
} from './result.ts'
import type { WriteContext } from '../lib/write-context.ts'
import type { ServiceResult } from './result.ts'
import type { Document } from '@execflow/db/schema'
import type { IntakeSourceChannel } from '@execflow/db/types'
import { findCaseById } from '../repositories/execution-case.ts'
import { findBundleById } from '../repositories/intake-bundle.ts'

export type RequestUploadInput = {
  fileName: string
  mimeType: string
  byteSize: number
  checksumSha256: string
  sourceChannel: IntakeSourceChannel
}

export type RequestUploadResult = {
  uploadId: string
  uploadToken: string
  storageKey: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

export type CompleteUploadInput = {
  uploadToken: string
  clientId?: string | undefined
  executionCaseId?: string | undefined
  intakeBundleId?: string | undefined
  documentClass?: string | undefined
  sensitivityLevel?: 'public' | 'standard' | 'sensitive' | 'restricted' | undefined
}

export async function requestUpload(
  ctx: WriteContext,
  input: RequestUploadInput
): Promise<ServiceResult<RequestUploadResult>> {
  const config = getStorageConfig()
  const storage = getStorageProvider()

  if (!input.fileName.trim()) {
    return validationError('fileName is required.', 'fileName')
  }
  if (!input.mimeType.trim()) {
    return validationError('mimeType is required.', 'mimeType')
  }
  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    return validationError('byteSize must be a positive integer.', 'byteSize')
  }
  if (input.byteSize > config.maxUploadBytes) {
    return validationError(
      `File exceeds maximum upload size of ${config.maxUploadBytes} bytes.`,
      'byteSize'
    )
  }
  if (!isValidChecksumSha256(input.checksumSha256)) {
    return validationError(
      'checksumSha256 must be a valid 64-character SHA-256 hex string.',
      'checksumSha256'
    )
  }
  if (!config.allowedMimeTypes.includes(input.mimeType)) {
    return validationError(`MIME type not allowed: ${input.mimeType}`, 'mimeType')
  }

  const validChannels: IntakeSourceChannel[] = [
    'intake_manual',
    'intake_pdf',
    'intake_scan',
    'intake_whatsapp',
    'intake_email',
    'intake_api',
    'intake_tribunal',
  ]
  if (!validChannels.includes(input.sourceChannel)) {
    return validationError(`Invalid source channel: ${input.sourceChannel}`, 'sourceChannel')
  }

  const uploadId = randomUUID()
  const storageKey = buildStorageKey({
    organizationId: ctx.organizationId,
    uploadId,
    fileName: input.fileName,
  })

  const expiresAt = new Date(Date.now() + config.uploadUrlExpiresSeconds * 1000)

  try {
    const presigned = await storage.createPresignedUpload({
      storageKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      expiresInSeconds: config.uploadUrlExpiresSeconds,
    })

    const uploadToken = signUploadToken({
      uploadId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      storageKey,
      fileName: input.fileName.trim(),
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      sourceChannel: input.sourceChannel,
      expiresAt,
    })

    await withTx(ctx.db, async (tx) => {
      unwrapOrThrow(
        await writeAuditLog(tx, {
          organizationId: ctx.organizationId,
          actorType: ctx.actor.actorType,
          actorId: ctx.actor.actorId,
          actorRole: ctx.actor.actorRole,
          impersonatingUserId: ctx.actor.impersonatingUserId,
          action: 'upload_requested',
          entityType: 'Upload',
          entityId: uploadId,
          changes: {
            type: 'creation',
            snapshot: {
              storageKey,
              fileName: input.fileName.trim(),
              mimeType: input.mimeType,
              byteSize: input.byteSize,
              checksumSha256: input.checksumSha256.toLowerCase(),
            },
          },
          requestId: ctx.requestId,
          metadata: { storageProvider: storage.id },
        })
      )
    })

    return ok({
      uploadId,
      uploadToken,
      storageKey,
      uploadUrl: presigned.uploadUrl,
      method: presigned.method,
      headers: presigned.headers,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (err) {
    console.error('[upload.service] requestUpload failed:', err)
    return internalServiceError('Failed to create upload request.', err)
  }
}

export async function completeUpload(
  ctx: WriteContext,
  input: CompleteUploadInput
): Promise<ServiceResult<Document>> {
  const token = verifyUploadToken(input.uploadToken)
  if (token === null) {
    return validationError('Invalid or expired upload token.', 'uploadToken')
  }

  if (token.organizationId !== ctx.organizationId) {
    return forbiddenError('Upload token does not belong to the active organization.')
  }

  try {
    assertStorageKeyBelongsToOrg(token.storageKey, ctx.organizationId)
  } catch {
    return forbiddenError('Upload token storage key is not valid for this organization.')
  }

  if (input.executionCaseId !== undefined) {
    const caseResult = await findCaseById(ctx.db, ctx.organizationId, input.executionCaseId)
    if (!caseResult.success) {
      return notFoundError('Execution case not found.')
    }
  }

  if (input.intakeBundleId !== undefined) {
    const bundleResult = await findBundleById(
      ctx.db,
      ctx.organizationId,
      input.intakeBundleId
    )
    if (!bundleResult.success) {
      return notFoundError('Intake bundle not found.')
    }
  }

  const storage = getStorageProvider()

  try {
    await storage.verifyObject({
      storageKey: token.storageKey,
      expectedByteSize: token.byteSize,
      expectedChecksumSha256: token.checksumSha256,
      expectedMimeType: token.mimeType,
    })
  } catch (err) {
    if (err instanceof StorageVerificationError) {
      if (err.code === 'NOT_FOUND') {
        return validationError(
          'Upload not found in storage. PUT the file to uploadUrl before completing.',
          'uploadToken'
        )
      }
      if (err.code === 'CHECKSUM_MISMATCH') {
        return validationError(
          'Checksum mismatch: stored bytes do not match declared checksumSha256.',
          'checksumSha256'
        )
      }
      return validationError(err.message)
    }
    return internalServiceError('Failed to verify uploaded object.', err)
  }

  const duplicate = await findDocumentByStorageKey(ctx.db, ctx.organizationId, token.storageKey)
  if (duplicate !== null) {
    return validationError('This upload has already been registered as a document.', 'uploadToken')
  }

  const registerResult = await registerDocument(ctx, {
    storageKey: token.storageKey,
    checksumSha256: token.checksumSha256,
    mimeType: token.mimeType,
    fileName: token.fileName,
    byteSize: token.byteSize,
    sourceChannel: token.sourceChannel,
    ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
    ...(input.executionCaseId !== undefined ? { executionCaseId: input.executionCaseId } : {}),
    ...(input.intakeBundleId !== undefined ? { intakeBundleId: input.intakeBundleId } : {}),
    ...(input.documentClass !== undefined ? { documentClass: input.documentClass } : {}),
    ...(input.sensitivityLevel !== undefined ? { sensitivityLevel: input.sensitivityLevel } : {}),
  })

  if (!registerResult.success) {
    return registerResult
  }

  try {
    await withTx(ctx.db, async (tx) => {
      unwrapOrThrow(
        await writeAuditLog(tx, {
          organizationId: ctx.organizationId,
          actorType: ctx.actor.actorType,
          actorId: ctx.actor.actorId,
          actorRole: ctx.actor.actorRole,
          impersonatingUserId: ctx.actor.impersonatingUserId,
          action: 'upload_completed',
          entityType: 'Upload',
          entityId: token.uploadId,
          changes: {
            type: 'state_transition',
            previous: 'pending_upload',
            next: 'registered',
            snapshot: { documentId: registerResult.data.id, storageKey: token.storageKey },
          },
          requestId: ctx.requestId,
          metadata: { documentId: registerResult.data.id },
        })
      )
    })
  } catch (err) {
    console.error('[upload.service] upload_completed audit failed:', err)
  }

  return registerResult
}

function checkContentType(contentType: string | undefined, expected: string): ServiceResult<never> | null {
  if (contentType !== undefined && contentType.split(';')[0]?.trim() !== expected) {
    return validationError('Content-Type does not match declared mimeType.', 'mimeType')
  }
  return null
}

/** Store blob bytes for local provider PUT handler (buffer path — kept for tests/small files). */
export async function storeUploadBlob(
  uploadToken: string,
  body: Buffer,
  contentType: string | undefined
): Promise<ServiceResult<{ byteSize: number }>> {
  const token = verifyUploadToken(uploadToken)
  if (token === null) {
    return validationError('Invalid or expired upload token.', 'uploadToken')
  }

  if (body.byteLength !== token.byteSize) {
    return validationError(
      `Upload body size ${body.byteLength} does not match declared byteSize ${token.byteSize}.`,
      'byteSize'
    )
  }

  const ctErr = checkContentType(contentType, token.mimeType)
  if (ctErr) return ctErr

  const storage = getStorageProvider()
  if (storage.putObject === undefined) {
    return validationError('Direct blob upload is not supported for this storage provider.')
  }

  try {
    await storage.putObject(token.storageKey, body, token.mimeType)
  } catch (err) {
    // Nunca deixa erro de disco (cheio, permissão, etc.) virar 500 opaco —
    // registra a causa real no log e devolve uma mensagem que o usuário
    // consegue agir (achado 07/07/2026: upload de auto grande falhava com
    // 500 genérico, sem log nenhum de causa — essa exceção subia crua).
    console.error('[upload] Falha ao gravar blob no storage:', err)
    return internalServiceError('Falha ao salvar o arquivo no armazenamento. Tente novamente; se persistir, avise o suporte.', err)
  }
  return ok({ byteSize: body.byteLength })
}

/**
 * Store blob via streaming (preferred path) — nunca bufferiza o arquivo
 * inteiro em memória. Autos escaneados grandes (200MB+) bufferizados podem
 * derrubar uma instância pequena por falta de memória; streaming grava
 * direto no disco em pedaços. Valida o tamanho DEPOIS de gravar (só se sabe
 * o total ao terminar de consumir o stream) — se não bater, apaga o arquivo.
 */
export async function storeUploadBlobStream(
  uploadToken: string,
  body: ReadableStream<Uint8Array>,
  contentType: string | undefined
): Promise<ServiceResult<{ byteSize: number }>> {
  const token = verifyUploadToken(uploadToken)
  if (token === null) {
    return validationError('Invalid or expired upload token.', 'uploadToken')
  }

  const ctErr = checkContentType(contentType, token.mimeType)
  if (ctErr) return ctErr

  const storage = getStorageProvider()
  if (storage.putObjectStream === undefined) {
    return validationError('Streaming blob upload is not supported for this storage provider.')
  }

  let result: { byteSize: number }
  try {
    result = await storage.putObjectStream(token.storageKey, body, token.mimeType)
  } catch (err) {
    console.error('[upload] Falha ao gravar blob (stream) no storage:', err)
    return internalServiceError('Falha ao salvar o arquivo no armazenamento. Tente novamente; se persistir, avise o suporte.', err)
  }

  if (result.byteSize !== token.byteSize) {
    return validationError(
      `Upload body size ${result.byteSize} does not match declared byteSize ${token.byteSize}.`,
      'byteSize'
    )
  }

  return ok({ byteSize: result.byteSize })
}

async function findDocumentByStorageKey(
  db: WriteContext['db'],
  organizationId: string,
  storageKey: string
): Promise<string | null> {
  const { documents } = await import('@execflow/db/schema')
  const { eq, and } = await import('drizzle-orm')
  const row = await db.query.documents.findFirst({
    where: and(
      eq(documents.organizationId, organizationId),
      eq(documents.storageKey, storageKey)
    ),
    columns: { id: true },
  })
  return row?.id ?? null
}
