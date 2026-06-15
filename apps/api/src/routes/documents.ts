/**
 * Document routes
 *   GET    /api/v1/documents                    — Paginated org document list
 *   GET    /api/v1/documents/:id              — Document detail
 *   GET    /api/v1/documents/:id/extraction   — Extraction review payload
 *   POST   /api/v1/documents                  — Register a document
 *   POST   /api/v1/documents/:id/associate    — Associate to client/case
 *   POST   /api/v1/documents/:id/archive      — Archive a document
 *
 * Authorization:
 * - Register: assistant+ (intake processing)
 * - Associate: assistant+ (intake review)
 * - Archive: assistant+ (intake review)
 *
 * NOTE: Prefer POST /api/v1/uploads/request → PUT blob → POST /api/v1/uploads/complete
 * for the standard upload flow. This register endpoint remains for integrations that
 * upload via external storage and already hold a verified storageKey + checksum.
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
import { getDocumentExtractionReview } from '../services/extraction-review.ts'
import { getDocumentDetail, listDocumentsForOrg } from '../services/document-read.ts'
import { findDocumentById } from '../repositories/document.ts'
import { toReadContext } from '../lib/read-context.ts'
import { PaginationQuerySchema } from '../lib/pagination-schemas.ts'
import { unprocessable } from '../lib/respond.ts'
import { getStorageProvider } from '../lib/storage.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const DocumentIdParamSchema = z.object({
  id: z.string().uuid('Invalid document ID.'),
})

const ListDocumentsQuerySchema = PaginationQuerySchema.extend({
  status: z
    .enum([
      'pending_association',
      'pending_extraction',
      'extraction_running',
      'extraction_review',
      'confirmed',
      'archived',
      'superseded',
      'rejected',
    ])
    .optional(),
  documentClass: z.string().max(100).optional(),
  q: z.string().max(200).optional(),
})

// -------------------------------------------------------------------------
// GET /api/v1/documents — Paginated org document list
// -------------------------------------------------------------------------

router.get(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = ListDocumentsQuerySchema.safeParse(c.req.query())
    if (!parsed.success) {
      return unprocessable(c, 'Invalid query parameters.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const q = parsed.data

    const result = await listDocumentsForOrg(
      ctx,
      {
        ...(q.status !== undefined ? { status: q.status } : {}),
        ...(q.documentClass !== undefined ? { documentClass: q.documentClass } : {}),
        ...(q.q !== undefined ? { q: q.q } : {}),
      },
      {
        limit: q.limit,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      }
    )

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data.items, nextCursor: result.data.nextCursor }, 200)
  }
)

// -------------------------------------------------------------------------
// GET /api/v1/documents/:id/extraction — Extraction review payload
// -------------------------------------------------------------------------

router.get(
  '/:id/extraction',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = DocumentIdParamSchema.safeParse({ id: c.req.param('id') })
    if (!parsed.success) {
      return unprocessable(c, 'Invalid document ID.', { issues: parsed.error.issues })
    }

    const ctx = buildWriteContext(c, db)
    const result = await getDocumentExtractionReview(ctx, parsed.data.id)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

// -------------------------------------------------------------------------
// GET /api/v1/documents/:id — Document detail
// -------------------------------------------------------------------------

router.get(
  '/:id',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = DocumentIdParamSchema.safeParse({ id: c.req.param('id') })
    if (!parsed.success) {
      return unprocessable(c, 'Invalid document ID.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const result = await getDocumentDetail(ctx, parsed.data.id)

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 200)
  }
)

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

// -------------------------------------------------------------------------
// GET /api/v1/documents/:id/download — Download document / get file contents
// -------------------------------------------------------------------------
router.get(
  '/:id/download',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = DocumentIdParamSchema.safeParse({ id: c.req.param('id') })
    if (!parsed.success) {
      return unprocessable(c, 'Invalid document ID.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const docResult = await findDocumentById(db, ctx.organizationId, parsed.data.id)
    if (!docResult.success) {
      return c.json({ error: 'Document not found.' }, 404)
    }

    const doc = docResult.data
    const storage = getStorageProvider()

    try {
      const buffer = await storage.getObject(doc.storageKey)
      const forceDownload = c.req.query('download') === 'true'
      const disposition = forceDownload ? 'attachment' : 'inline'
      
      c.header('Content-Type', doc.mimeType ?? 'application/octet-stream')
      c.header('Content-Disposition', `${disposition}; filename="${encodeURIComponent(doc.fileName)}"`)
      return c.body(buffer as any)
    } catch (err) {
      console.error('[documents.router] download failed:', err)
      return c.json({ error: 'Failed to retrieve file from storage.' }, 500)
    }
  }
)

export { router as documentsRouter }
