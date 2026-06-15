/**
 * Snapshot promotion event consumers.
 *
 * document.confirmed           → snapshot.promotion.requested
 * snapshot.promotion.requested → snapshot.proposed (proposed snapshot row)
 */

import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import {
  parseDocumentConfirmedPayload,
  parseSnapshotPromotionRequestedPayload,
} from '@execflow/db/types'
import {
  requestSnapshotPromotion,
  executeSnapshotPromotion,
} from '../snapshot-promotion/runner.ts'

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

export async function handleDocumentConfirmedForSnapshotPromotion(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseEnvelope(job)
  if (env === null) return

  const parsed = parseDocumentConfirmedPayload(env.payload)
  if (parsed === null) return
  if (parsed.organizationId !== env.organizationId) return

  const triggerEventId = env.eventId
  if (triggerEventId === null) return

  const confirmedByUserId =
    typeof env.payload['confirmedByUserId'] === 'string'
      ? env.payload['confirmedByUserId']
      : null

  await requestSnapshotPromotion(db, {
    organizationId: env.organizationId,
    documentId: parsed.documentId,
    triggerEventId,
    correlationId: env.correlationId ?? triggerEventId,
    promotedByUserId: confirmedByUserId,
  })
}

export async function handleSnapshotPromotionRequested(
  db: WorkersDb,
  job: Job<unknown>
): Promise<void> {
  const env = parseEnvelope(job)
  if (env === null) return

  const parsed = parseSnapshotPromotionRequestedPayload(env.payload)
  if (parsed === null) return
  if (parsed.organizationId !== env.organizationId) return

  await executeSnapshotPromotion(db, {
    promotionId: parsed.promotionId,
    organizationId: parsed.organizationId,
    correlationId: env.correlationId,
    causationEventId: env.eventId,
  })
}
