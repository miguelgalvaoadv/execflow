/**
 * Event consumers for Intake and Document domain events.
 *
 * REGISTERED CONSUMERS:
 * - intake.registered      → create queue projection in intake_review queue
 * - document.associated    → create/update queue projection in extraction_review
 * - document.confirmed     → resolve queue projections for document
 *
 * Payload contracts: @execflow/db/types (document-layer-events.ts)
 *
 * Architecture ref: office-operating-system.md §2.1 (queue catalog),
 *                   event-state-architecture.md §3.3 (document state machine).
 */

import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import {
  isDocumentExtractionQueueStatus,
  parseDocumentAssociatedPayload,
  parseDocumentConfirmedPayload,
  parseIntakeRegisteredPayload,
} from '@execflow/db/types'
import {
  upsertQueueProjection,
  resolveQueueProjection,
} from '../projections/queue-projection.ts'
import { createIntakeTriageTask } from '../projections/workflow-task.ts'
import { handleDocumentAssociatedForEngine } from './engine-events.ts'

type DomainEventJob = Job<{
  eventId: string
  eventType: string
  payload: Record<string, unknown>
  occurredAt: string
  organizationId: string | null
  correlationId: string
  causationId: string | null
}>

/**
 * Computes intake review SLA: 24 business hours from intake.
 * Simplified: 24 calendar hours for Phase 6.
 */
function intakeSlaDeadline(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000)
}

/**
 * Handles intake.registered events.
 *
 * Per office-operating-system.md §2.1 (intake_review queue):
 * Entry condition: IntakeBundle with association_state = 'unassigned'
 * SLA: 24h business hours from uploaded_at
 */
export async function handleIntakeRegistered(
  db: WorkersDb,
  job: DomainEventJob
): Promise<void> {
  const { payload, organizationId, eventId } = job.data

  if (!organizationId) return

  const parsed = parseIntakeRegisteredPayload(payload)
  if (parsed === null) return

  const slaDeadlineAt = intakeSlaDeadline()

  await upsertQueueProjection(db, {
    organizationId,
    queueType: 'intake_review',
    entityType: 'IntakeBundle',
    entityId: parsed.intakeBundleId,
    priority: 2,
    displayTitle: `Entrada: ${parsed.ref}`,
    displayLabel: 'intake_review',
    keyDate: new Date(parsed.receivedAt),
    slaDeadlineAt,
    sourceCausingEventId: eventId,
    metadata: { intakeBundleRef: parsed.ref },
  })

  await createIntakeTriageTask(db, {
    organizationId,
    intakeBundleId: parsed.intakeBundleId,
    intakeBundleRef: parsed.ref,
    causingEventId: eventId,
  })
}

/**
 * Handles document.associated events.
 *
 * extraction_review queue entry (pre-OCR hardening):
 * Document status is pending_extraction (associated, OCR not run) OR
 * extraction_review (OCR complete — Phase 5+).
 */
export async function handleDocumentAssociated(
  db: WorkersDb,
  job: DomainEventJob
): Promise<void> {
  const { payload, organizationId, eventId } = job.data

  if (!organizationId) return

  const parsed = parseDocumentAssociatedPayload(payload)
  if (parsed === null) return

  const documentClass = parsed.documentClass ?? 'document'

  if (isDocumentExtractionQueueStatus(parsed.status)) {
    const slaDeadlineAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

    await upsertQueueProjection(db, {
      organizationId,
      queueType: 'extraction_review',
      entityType: 'Document',
      entityId: parsed.documentId,
      ...(parsed.executionCaseId !== null ? { executionCaseId: parsed.executionCaseId } : {}),
      priority: 2,
      displayTitle: `Extração para revisar: ${documentClass}`,
      displayLabel: documentClass,
      slaDeadlineAt,
      sourceCausingEventId: eventId,
      metadata: { documentClass, documentStatus: parsed.status },
    })
  }

  if (parsed.status === 'association_review' || parsed.status === 'pending_association') {
    await resolveQueueProjection(db, {
      organizationId,
      queueType: 'intake_review',
      entityType: 'Document',
      entityId: parsed.documentId,
    })
  }

  await handleDocumentAssociatedForEngine(db, job as Job<unknown>)
}

/**
 * Handles document.confirmed events.
 * Document exits extraction_review queue when confirmed.
 */
export async function handleDocumentConfirmed(
  db: WorkersDb,
  job: DomainEventJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const parsed = parseDocumentConfirmedPayload(payload)
  if (parsed === null) return

  for (const queueType of ['extraction_review', 'intake_review'] as const) {
    await resolveQueueProjection(db, {
      organizationId,
      queueType,
      entityType: 'Document',
      entityId: parsed.documentId,
    })
  }
}
