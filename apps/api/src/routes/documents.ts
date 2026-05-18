/**
 * Document routes
 *   POST   /api/v1/documents                    — Register a document
 *   POST   /api/v1/documents/:id/associate      — Associate to client/case
 *   POST   /api/v1/documents/:id/archive        — Archive a document
 *
 * Authorization:
 * - Register: assistant+ (intake processing)
 * - Associate: assistant+ (intake review)
 * - Archive: assistant+ (intake review)
 *
 * NOTE: The blob upload (to R2/storage) happens BEFORE calling these endpoints.
 * These endpoints register the metadata. The storageKey and checksum are provided
 * by the upload endpoint after verifying the blob was stored successfully.
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
import { registerDocument, associateDocumentToCase, archiveDocument } from '../services/document.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// POST /api/v1/documents — Register document metadata
// -------------------------------------------------------------------------

const RegisterDocumentSchema = z.object({
  /**
   * Blob storage object key. The blob must already be in storage.
   * The upload step should have verified the checksum before calling this endpoint.
   */
  storageKey: z.string().min(1, 'Storage key is required').max(500),

  /**
   * SHA-256 hex checksum of the file bytes.
   * Must be exactly 64 lowercase hex characters.
   */
  checksumSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'checksumSha256 must be a 64-character SHA-256 hex string'),

  mimeType: z.string().min(1).max(200),
  fileName: z.string().min(1).max(500),

  /** File size in bytes. Must be positive. */
  byteSize: z.number().int().positive(),

  sourceChannel: z.enum([
    'intake_manual',
    'intake_pdf',
    'intake_scan',
    'intake_whatsapp',
    'intake_email',
    'intake_api',
    'intake_tribunal',
  ]),

  /** When the file was uploaded to blob storage (ISO 8601). */
  uploadedAt: z.string().optional(),

  clientId: z.string().uuid().optional(),
  executionCaseId: z.string().uuid().optional(),
  intakeBundleId: z.string().uuid().optional(),

  /** Legal document class. Free text. */
  documentClass: z.string().max(100).optional(),

  sensitivityLevel: z
    .enum(['public', 'standard', 'sensitive', 'restricted'])
    .optional(),

  /** UUID of the document this supersedes (if replacing a prior version). */
  supersedesDocumentId: z.string().uuid().optional(),

  /** For WhatsApp intake: the forwarding phone number. LGPD sensitive. */
  whatsappForwardedFrom: z.string().max(50).optional(),
})

router.post(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(RegisterDocumentSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await registerDocument(ctx, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/documents/:id/associate — Associate to client/case
// -------------------------------------------------------------------------

const AssociateDocumentSchema = z.object({
  clientId: z.string().uuid().optional(),
  executionCaseId: z.string().uuid().optional(),
  documentClass: z.string().max(100).optional(),
}).refine(
  (data) => data.clientId || data.executionCaseId,
  { message: 'At least one of clientId or executionCaseId must be provided.' }
)

router.post(
  '/:id/associate',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const documentId = c.req.param('id')

    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(AssociateDocumentSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await associateDocumentToCase(ctx, documentId, parsed.data)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data })
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/documents/:id/archive — Archive a document
// -------------------------------------------------------------------------

router.post(
  '/:id/archive',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const documentId = c.req.param('id')

    const ctx = buildWriteContext(c, db)
    const result = await archiveDocument(ctx, documentId)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data })
  }
)

export { router as documentsRouter }
