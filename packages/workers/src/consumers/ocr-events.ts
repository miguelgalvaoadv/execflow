/**
 * OCR pipeline event consumers.
 *
 * document.registered → schedule ocr_run + ocr.requested
 * ocr.requested       → execute OCR (running → completed | failed)
 */

import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import { eq, and } from '@execflow/db/client'
import {
  parseDocumentRegisteredPayload,
  parseOcrRequestedPayload,
  isOcrEligibleMimeType,
} from '@execflow/db/types'
import { createOcrProvider, resolveOcrMaxAttempts } from '@execflow/ocr'
import { createStorageProviderFromEnv } from '@execflow/storage'
import { scheduleOcrForDocument, executeOcrRun } from '../ocr/runner.ts'

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

// O provider real (pdf-text, padrão) lê o blob — storage injetado aqui.
function buildOcrProvider(): ReturnType<typeof createOcrProvider> {
  const storage = createStorageProviderFromEnv()
  return createOcrProvider(process.env, {
    getObject: (storageKey) => storage.getObject(storageKey),
  })
}

let ocrProvider = buildOcrProvider()
console.info(`[ocr-events] Provider de OCR ativo: ${ocrProvider.id}`)

/** Test hook — inject mock provider. */
export function setOcrProviderForTests(provider: ReturnType<typeof createOcrProvider>): void {
  ocrProvider = provider
}

export function resetOcrProviderForTests(): void {
  ocrProvider = buildOcrProvider()
}

export async function handleDocumentRegisteredForOcr(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseEnvelope(job)
  if (env === null) return

  const parsed = parseDocumentRegisteredPayload(env.payload)
  if (parsed === null) return
  if (parsed.organizationId !== env.organizationId) return

  const { documents } = await import('@execflow/db/schema')

  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.id, parsed.documentId), eq(documents.organizationId, env.organizationId))
    )
    .limit(1)

  if (doc === undefined) return
  if (doc.ocrStatus !== 'pending') return

  if (!isOcrEligibleMimeType(doc.mimeType)) {
    await db
      .update(documents)
      .set({ ocrStatus: 'not_applicable', updatedAt: new Date() })
      .where(eq(documents.id, doc.id))
    return
  }

  const triggerEventId = env.eventId
  if (triggerEventId === null) return

  await scheduleOcrForDocument(db, {
    organizationId: env.organizationId,
    documentId: doc.id,
    triggerEventId,
    correlationId: env.correlationId ?? triggerEventId,
    providerId: ocrProvider.id,
    maxAttempts: resolveOcrMaxAttempts(),
  })
}

export async function handleOcrRequested(db: WorkersDb, job: Job<unknown>): Promise<void> {
  const env = parseEnvelope(job)
  if (env === null) return

  const parsed = parseOcrRequestedPayload(env.payload)
  if (parsed === null) return
  if (parsed.organizationId !== env.organizationId) return

  await executeOcrRun(db, ocrProvider, {
    ocrRunId: parsed.ocrRunId,
    organizationId: parsed.organizationId,
    correlationId: env.correlationId,
    causationEventId: env.eventId,
  })
}
