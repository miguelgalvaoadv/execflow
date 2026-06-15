/**
 * OCR domain event contracts.
 */

export const OCR_REQUESTED = 'ocr.requested' as const
export const OCR_RUNNING = 'ocr.running' as const
export const OCR_COMPLETED = 'ocr.completed' as const
export const OCR_FAILED = 'ocr.failed' as const

export const DOCUMENT_REGISTERED = 'document.registered' as const

/** MIME types eligible for OCR processing. */
export const OCR_ELIGIBLE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
] as const

export function isOcrEligibleMimeType(mimeType: string): boolean {
  return (OCR_ELIGIBLE_MIME_TYPES as readonly string[]).includes(mimeType)
}

export type OcrRequestedPayload = {
  ocrRunId: string
  documentId: string
  organizationId: string
  providerId: string
  runNumber: number
  attemptNumber: number
}

export type OcrCompletedPayload = {
  ocrRunId: string
  documentId: string
  organizationId: string
  providerId: string
  pageCount: number
  resultId: string
}

export type OcrFailedPayload = {
  ocrRunId: string
  documentId: string
  organizationId: string
  providerId: string
  attemptNumber: number
  retryable: boolean
  errorMessage: string
}

export function parseDocumentRegisteredPayload(
  payload: Record<string, unknown>
): { documentId: string; organizationId: string } | null {
  const documentId = typeof payload['documentId'] === 'string' ? payload['documentId'] : null
  const organizationId =
    typeof payload['organizationId'] === 'string' ? payload['organizationId'] : null
  if (documentId === null || organizationId === null) return null
  return { documentId, organizationId }
}

export function parseOcrRequestedPayload(
  payload: Record<string, unknown>
): OcrRequestedPayload | null {
  const ocrRunId = typeof payload['ocrRunId'] === 'string' ? payload['ocrRunId'] : null
  const documentId = typeof payload['documentId'] === 'string' ? payload['documentId'] : null
  const organizationId =
    typeof payload['organizationId'] === 'string' ? payload['organizationId'] : null
  const providerId = typeof payload['providerId'] === 'string' ? payload['providerId'] : null
  if (ocrRunId === null || documentId === null || organizationId === null || providerId === null) {
    return null
  }
  return {
    ocrRunId,
    documentId,
    organizationId,
    providerId,
    runNumber: typeof payload['runNumber'] === 'number' ? payload['runNumber'] : 1,
    attemptNumber: typeof payload['attemptNumber'] === 'number' ? payload['attemptNumber'] : 1,
  }
}

export function parseOcrCompletedPayload(
  payload: Record<string, unknown>
): OcrCompletedPayload | null {
  const ocrRunId = typeof payload['ocrRunId'] === 'string' ? payload['ocrRunId'] : null
  const documentId = typeof payload['documentId'] === 'string' ? payload['documentId'] : null
  const organizationId =
    typeof payload['organizationId'] === 'string' ? payload['organizationId'] : null
  const providerId = typeof payload['providerId'] === 'string' ? payload['providerId'] : null
  const resultId = typeof payload['resultId'] === 'string' ? payload['resultId'] : null
  if (
    ocrRunId === null ||
    documentId === null ||
    organizationId === null ||
    providerId === null ||
    resultId === null
  ) {
    return null
  }
  return {
    ocrRunId,
    documentId,
    organizationId,
    providerId,
    pageCount: typeof payload['pageCount'] === 'number' ? payload['pageCount'] : 1,
    resultId,
  }
}
