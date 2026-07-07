/**
 * Upload routes — presigned upload lifecycle.
 *
 * POST /api/v1/uploads/request   — issue presigned upload URL + token
 * POST /api/v1/uploads/complete  — verify checksum + register document
 * PUT  /api/v1/uploads/blob      — local provider direct upload (dev/test)
 *
 * Authorization: assistant+ for request/complete; blob PUT is token-authenticated.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { serviceErrorToResponse, safeJsonBody } from '../lib/route-helpers.ts'
import { requestUpload, completeUpload, storeUploadBlobStream } from '../services/upload.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'
import { getStorageProvider } from '../lib/storage.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const RequestUploadSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  byteSize: z.number().int().positive(),
  checksumSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'checksumSha256 must be a 64-character SHA-256 hex string'),
  sourceChannel: z.enum([
    'intake_manual',
    'intake_pdf',
    'intake_scan',
    'intake_whatsapp',
    'intake_email',
    'intake_api',
    'intake_tribunal',
  ]),
})

const CompleteUploadSchema = z.object({
  uploadToken: z.string().min(1),
  clientId: z.string().uuid().optional(),
  executionCaseId: z.string().uuid().optional(),
  intakeBundleId: z.string().uuid().optional(),
  documentClass: z.string().max(100).optional(),
  sensitivityLevel: z.enum(['public', 'standard', 'sensitive', 'restricted']).optional(),
})

router.post(
  '/request',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(RequestUploadSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await requestUpload(ctx, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

router.post(
  '/complete',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(CompleteUploadSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await completeUpload(ctx, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

/**
 * Local storage PUT target — authenticated via X-Upload-Token (not session).
 * Only registered when STORAGE_PROVIDER=local.
 */
router.put('/blob', async (c) => {
  const storage = getStorageProvider()
  if (storage.id !== 'local') {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Direct blob upload is not enabled.' } },
      404
    )
  }

  const uploadToken = c.req.header('X-Upload-Token')
  if (uploadToken === undefined || uploadToken === '') {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'X-Upload-Token header is required.' } },
      401
    )
  }

  const body = c.req.raw.body
  if (body === null) {
    return c.json({ error: { code: 'UNPROCESSABLE', message: 'Request has no body.' } }, 422)
  }
  const contentType = c.req.header('Content-Type') ?? undefined

  // Streaming: nunca bufferiza o arquivo inteiro em memória (autos escaneados
  // grandes podem passar de 100-200MB — bufferizar arrisca OOM numa instância
  // pequena). Achado 07/07/2026 ao investigar upload de auto grande falhando
  // com 500 opaco.
  const result = await storeUploadBlobStream(uploadToken, body, contentType)
  if (!result.success) {
    return serviceErrorToResponse(c, result.error)
  }

  return c.json({ data: { byteSize: result.data.byteSize } }, 200)
})

export { router as uploadsRouter }
