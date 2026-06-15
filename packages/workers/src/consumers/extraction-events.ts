/**
 * Extraction pipeline event consumers.
 *
 * ocr.completed         → schedule extraction_run + extraction.requested
 * extraction.requested  → execute extraction (running → review | failed)
 */

import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import { eq, and } from '@execflow/db/client'
import { parseOcrCompletedPayload, parseExtractionRequestedPayload } from '@execflow/db/types'
import {
  createExtractionProvider,
  resolveExtractionMaxAttempts,
  resolveDefaultExtractionType,
} from '@execflow/extraction'
import {
  scheduleExtractionForDocument,
  executeExtractionRun,
} from '../extraction/runner.ts'

type RelayJobEnvelope = {
  eventId?: string
  payload?: Record<string, unknown>
  organizationId?: string | null
  correlationId?: string
  causationId?: string | null
}

function parseEnvelope(job: Job<unknown>): {
  organizationId: string
  payload: Record<string, unknown>
  correlationId: string | null
  eventId: string | null
} | null {
  const d = job.data as RelayJobEnvelope
  const payload =
    d.payload !== undefined && typeof d.payload === 'object' && d.payload !== null
      ? d.payload
      : {}
  const organizationId =
    typeof d.organizationId === 'string'
      ? d.organizationId
      : typeof payload['organizationId'] === 'string'
        ? payload['organizationId']
        : null
  if (organizationId === null) return null
  return {
    organizationId,
    payload,
    correlationId: typeof d.correlationId === 'string' ? d.correlationId : null,
    eventId: typeof d.eventId === 'string' ? d.eventId : null,
  }
}

let extractionProvider = createExtractionProvider()

export function setExtractionProviderForTests(
  provider: ReturnType<typeof createExtractionProvider>
): void {
  extractionProvider = provider
}

export function resetExtractionProviderForTests(): void {
  extractionProvider = createExtractionProvider()
}

export async function handleOcrCompletedForExtraction(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseEnvelope(job)
  if (env === null) return

  const parsed = parseOcrCompletedPayload(env.payload)
  if (parsed === null) return
  if (parsed.organizationId !== env.organizationId) return

  const { documents, documentOcrResults } = await import('@execflow/db/schema')

  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.id, parsed.documentId), eq(documents.organizationId, env.organizationId))
    )
    .limit(1)

  if (doc === undefined) return
  if (doc.ocrStatus !== 'completed') return

  const [ocrResult] = await db
    .select({ id: documentOcrResults.id })
    .from(documentOcrResults)
    .where(
      and(
        eq(documentOcrResults.id, parsed.resultId),
        eq(documentOcrResults.ocrRunId, parsed.ocrRunId),
        eq(documentOcrResults.documentId, parsed.documentId)
      )
    )
    .limit(1)

  if (ocrResult === undefined) return

  const triggerEventId = env.eventId
  if (triggerEventId === null) return

  await scheduleExtractionForDocument(db, {
    organizationId: env.organizationId,
    documentId: doc.id,
    ocrRunId: parsed.ocrRunId,
    ocrResultId: parsed.resultId,
    triggerEventId,
    correlationId: env.correlationId ?? triggerEventId,
    providerId: extractionProvider.id,
    extractionType: resolveDefaultExtractionType(),
    maxAttempts: resolveExtractionMaxAttempts(),
  })
}

export async function handleExtractionRequested(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseEnvelope(job)
  if (env === null) return

  const parsed = parseExtractionRequestedPayload(env.payload)
  if (parsed === null) return
  if (parsed.organizationId !== env.organizationId) return

  await executeExtractionRun(db, extractionProvider, {
    extractionRunId: parsed.extractionRunId,
    organizationId: parsed.organizationId,
    correlationId: env.correlationId,
    causationEventId: env.eventId,
  })
}
