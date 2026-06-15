/**
 * Extraction domain event contracts.
 */

export const EXTRACTION_REQUESTED = 'extraction.requested' as const
export const EXTRACTION_RUNNING = 'extraction.running' as const
export const EXTRACTION_REVIEW = 'extraction.review' as const
export const EXTRACTION_CONFIRMED = 'extraction.confirmed' as const
export const EXTRACTION_REJECTED = 'extraction.rejected' as const
export const EXTRACTION_FAILED = 'extraction.failed' as const

export type ExtractionRequestedPayload = {
  extractionRunId: string
  documentId: string
  organizationId: string
  ocrRunId: string
  ocrResultId: string
  providerId: string
  extractionType: string
  runNumber: number
  attemptNumber: number
}

export type ExtractionReviewPayload = {
  extractionRunId: string
  documentId: string
  organizationId: string
  providerId: string
  extractionType: string
  resultId: string
  confidence: string
}

export type ExtractionConfirmedPayload = {
  extractionRunId: string
  documentId: string
  organizationId: string
  confirmedByUserId: string
  resultId: string
}

export type ExtractionFailedPayload = {
  extractionRunId: string
  documentId: string
  organizationId: string
  providerId: string
  attemptNumber: number
  retryable: boolean
  errorMessage: string
}

export function parseExtractionRequestedPayload(
  payload: Record<string, unknown>
): ExtractionRequestedPayload | null {
  const extractionRunId =
    typeof payload['extractionRunId'] === 'string' ? payload['extractionRunId'] : null
  const documentId = typeof payload['documentId'] === 'string' ? payload['documentId'] : null
  const organizationId =
    typeof payload['organizationId'] === 'string' ? payload['organizationId'] : null
  const ocrRunId = typeof payload['ocrRunId'] === 'string' ? payload['ocrRunId'] : null
  const ocrResultId = typeof payload['ocrResultId'] === 'string' ? payload['ocrResultId'] : null
  const providerId = typeof payload['providerId'] === 'string' ? payload['providerId'] : null
  const extractionType =
    typeof payload['extractionType'] === 'string' ? payload['extractionType'] : 'generic'
  if (
    extractionRunId === null ||
    documentId === null ||
    organizationId === null ||
    ocrRunId === null ||
    ocrResultId === null ||
    providerId === null
  ) {
    return null
  }
  return {
    extractionRunId,
    documentId,
    organizationId,
    ocrRunId,
    ocrResultId,
    providerId,
    extractionType,
    runNumber: typeof payload['runNumber'] === 'number' ? payload['runNumber'] : 1,
    attemptNumber: typeof payload['attemptNumber'] === 'number' ? payload['attemptNumber'] : 1,
  }
}

export function parseExtractionConfirmedPayload(
  payload: Record<string, unknown>
): ExtractionConfirmedPayload | null {
  const extractionRunId =
    typeof payload['extractionRunId'] === 'string' ? payload['extractionRunId'] : null
  const documentId = typeof payload['documentId'] === 'string' ? payload['documentId'] : null
  const organizationId =
    typeof payload['organizationId'] === 'string' ? payload['organizationId'] : null
  const confirmedByUserId =
    typeof payload['confirmedByUserId'] === 'string' ? payload['confirmedByUserId'] : null
  const resultId = typeof payload['resultId'] === 'string' ? payload['resultId'] : null
  if (
    extractionRunId === null ||
    documentId === null ||
    organizationId === null ||
    confirmedByUserId === null ||
    resultId === null
  ) {
    return null
  }
  return { extractionRunId, documentId, organizationId, confirmedByUserId, resultId }
}
