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
import { createOcrProvider, resolveOcrMaxAttempts, OcrProviderError } from '@execflow/ocr'
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
//
// CONSTRUÇÃO PREGUIÇOSA E BLINDADA (crítico): NUNCA construir isto no
// carregamento do módulo. Se STORAGE_PROVIDER=s3 e faltar credencial, isso
// lança — e como este módulo é importado no boot do worker (junto com
// InfoSimples/DJEN/DataJud/SLA), um erro aqui derrubava o PROCESSO INTEIRO a
// cada reinício (loop de crash observado em produção 06/07/2026). A falta de
// storage deve derrubar só o OCR, nunca as outras integrações que não usam
// storage nenhum.
let cachedProvider: ReturnType<typeof createOcrProvider> | null = null

function getOcrProvider(): ReturnType<typeof createOcrProvider> {
  if (cachedProvider) return cachedProvider
  try {
    const storage = createStorageProviderFromEnv()
    cachedProvider = createOcrProvider(process.env, {
      getObject: (storageKey) => storage.getObject(storageKey),
    })
    console.info(`[ocr-events] Provider de OCR ativo: ${cachedProvider.id}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `[ocr-events] Storage/OCR mal configurado — OCR ficará indisponível até corrigir (demais integrações NÃO são afetadas): ${message}`
    )
    cachedProvider = {
      id: 'unavailable',
      async extractText() {
        throw new OcrProviderError(`OCR indisponível: ${message}`, { retryable: false })
      },
    }
  }
  return cachedProvider
}

/** Test hook — inject mock provider. */
export function setOcrProviderForTests(provider: ReturnType<typeof createOcrProvider>): void {
  cachedProvider = provider
}

export function resetOcrProviderForTests(): void {
  cachedProvider = null
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
    providerId: getOcrProvider().id,
    maxAttempts: resolveOcrMaxAttempts(),
  })
}

export async function handleOcrRequested(db: WorkersDb, job: Job<unknown>): Promise<void> {
  const env = parseEnvelope(job)
  if (env === null) return

  const parsed = parseOcrRequestedPayload(env.payload)
  if (parsed === null) return
  if (parsed.organizationId !== env.organizationId) return

  await executeOcrRun(db, getOcrProvider(), {
    ocrRunId: parsed.ocrRunId,
    organizationId: parsed.organizationId,
    correlationId: env.correlationId,
    causationEventId: env.eventId,
  })
}
