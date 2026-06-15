/**
 * Document layer domain event contracts — canonical event types and payload shapes.
 *
 * Producers (apps/api services) and consumers (packages/workers) MUST align on
 * these contracts. Parsers accept legacy field names for replay of in-flight events.
 *
 * Architecture ref: event-state-architecture.md §2.1, office-operating-system.md §2.1.
 */

// ---------------------------------------------------------------------------
// Event type constants
// ---------------------------------------------------------------------------

export const INTAKE_REGISTERED = 'intake.registered' as const

export const DOCUMENT_REGISTERED = 'document.registered' as const
export const DOCUMENT_ASSOCIATED = 'document.associated' as const
export const DOCUMENT_ARCHIVED = 'document.archived' as const
export const DOCUMENT_CONFIRMED = 'document.confirmed' as const

// ---------------------------------------------------------------------------
// Document status → queue mapping (pre-OCR hardening)
// ---------------------------------------------------------------------------

/**
 * Document statuses that place a document in the extraction_review queue.
 *
 * - pending_extraction: associated, OCR not yet run (current Phase 4 behaviour)
 * - extraction_review: OCR complete, awaiting human field confirmation (Phase 5+)
 */
export const DOCUMENT_STATUSES_FOR_EXTRACTION_REVIEW_QUEUE = [
  'pending_extraction',
  'extraction_review',
] as const

export type DocumentExtractionQueueStatus =
  (typeof DOCUMENT_STATUSES_FOR_EXTRACTION_REVIEW_QUEUE)[number]

export function isDocumentExtractionQueueStatus(
  status: string | undefined
): status is DocumentExtractionQueueStatus {
  return (
    status !== undefined &&
    (DOCUMENT_STATUSES_FOR_EXTRACTION_REVIEW_QUEUE as readonly string[]).includes(status)
  )
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export type IntakeRegisteredPayload = {
  intakeBundleId: string
  organizationId: string
  sourceChannel: string
  receivedAt: string
  uploaderUserId: string
  status: 'received'
  ref: string
  hasMissingFields: boolean
  missingFieldCount: number
}

export type DocumentAssociatedPayload = {
  documentId: string
  organizationId: string
  clientId: string | null
  executionCaseId: string | null
  documentClass: string | null
  previousStatus: string
  /** Canonical current document status after association. */
  status: string
}

export type DocumentConfirmedPayload = {
  documentId: string
  organizationId: string
  previousStatus: string
  status: 'confirmed'
}

// ---------------------------------------------------------------------------
// Payload builders (producers)
// ---------------------------------------------------------------------------

export function buildIntakeRegisteredPayload(params: {
  intakeBundleId: string
  organizationId: string
  sourceChannel: string
  receivedAt: Date
  uploaderUserId: string
  ref: string
  hasMissingFields: boolean
  missingFieldCount: number
}): IntakeRegisteredPayload {
  return {
    intakeBundleId: params.intakeBundleId,
    organizationId: params.organizationId,
    sourceChannel: params.sourceChannel,
    receivedAt: params.receivedAt.toISOString(),
    uploaderUserId: params.uploaderUserId,
    status: 'received',
    ref: params.ref,
    hasMissingFields: params.hasMissingFields,
    missingFieldCount: params.missingFieldCount,
  }
}

export function buildDocumentAssociatedPayload(params: {
  documentId: string
  organizationId: string
  clientId: string | null
  executionCaseId: string | null
  documentClass: string | null
  previousStatus: string
  status: string
}): DocumentAssociatedPayload {
  return {
    documentId: params.documentId,
    organizationId: params.organizationId,
    clientId: params.clientId,
    executionCaseId: params.executionCaseId,
    documentClass: params.documentClass,
    previousStatus: params.previousStatus,
    status: params.status,
  }
}

export function buildDocumentConfirmedPayload(params: {
  documentId: string
  organizationId: string
  previousStatus: string
  status: 'confirmed'
}): DocumentConfirmedPayload {
  return {
    documentId: params.documentId,
    organizationId: params.organizationId,
    previousStatus: params.previousStatus,
    status: params.status,
  }
}

// ---------------------------------------------------------------------------
// Payload parsers (consumers) — legacy aliases for replay safety
// ---------------------------------------------------------------------------

export function parseIntakeRegisteredPayload(
  payload: Record<string, unknown>
): IntakeRegisteredPayload | null {
  const intakeBundleId =
    typeof payload['intakeBundleId'] === 'string'
      ? payload['intakeBundleId']
      : typeof payload['bundleId'] === 'string'
        ? payload['bundleId']
        : null

  if (intakeBundleId === null) return null

  const organizationId =
    typeof payload['organizationId'] === 'string' ? payload['organizationId'] : ''
  const sourceChannel =
    typeof payload['sourceChannel'] === 'string' ? payload['sourceChannel'] : 'unknown'
  const receivedAt =
    typeof payload['receivedAt'] === 'string' ? payload['receivedAt'] : new Date().toISOString()
  const uploaderUserId =
    typeof payload['uploaderUserId'] === 'string' ? payload['uploaderUserId'] : ''
  const ref =
    typeof payload['ref'] === 'string'
      ? payload['ref']
      : typeof payload['sourceChannel'] === 'string'
        ? payload['sourceChannel']
        : 'entrada'

  return {
    intakeBundleId,
    organizationId,
    sourceChannel,
    receivedAt,
    uploaderUserId,
    status: 'received',
    ref,
    hasMissingFields: payload['hasMissingFields'] === true,
    missingFieldCount:
      typeof payload['missingFieldCount'] === 'number' ? payload['missingFieldCount'] : 0,
  }
}

export function parseDocumentAssociatedPayload(
  payload: Record<string, unknown>
): DocumentAssociatedPayload | null {
  const documentId =
    typeof payload['documentId'] === 'string' ? payload['documentId'] : null
  if (documentId === null) return null

  const status =
    typeof payload['status'] === 'string'
      ? payload['status']
      : typeof payload['newStatus'] === 'string'
        ? payload['newStatus']
        : ''

  return {
    documentId,
    organizationId:
      typeof payload['organizationId'] === 'string' ? payload['organizationId'] : '',
    clientId: typeof payload['clientId'] === 'string' ? payload['clientId'] : null,
    executionCaseId:
      typeof payload['executionCaseId'] === 'string' ? payload['executionCaseId'] : null,
    documentClass:
      typeof payload['documentClass'] === 'string' ? payload['documentClass'] : null,
    previousStatus:
      typeof payload['previousStatus'] === 'string' ? payload['previousStatus'] : '',
    status,
  }
}

export function parseDocumentConfirmedPayload(
  payload: Record<string, unknown>
): DocumentConfirmedPayload | null {
  const documentId =
    typeof payload['documentId'] === 'string' ? payload['documentId'] : null
  if (documentId === null) return null

  return {
    documentId,
    organizationId:
      typeof payload['organizationId'] === 'string' ? payload['organizationId'] : '',
    previousStatus:
      typeof payload['previousStatus'] === 'string' ? payload['previousStatus'] : '',
    status: 'confirmed',
  }
}
