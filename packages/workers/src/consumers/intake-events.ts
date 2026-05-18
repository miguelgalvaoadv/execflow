/**
 * Event consumers for Intake and Document domain events.
 *
 * REGISTERED CONSUMERS:
 * - intake.registered      → create queue projection in intake_review queue
 * - document.associated    → create/update queue projection in extraction_review
 * - document.confirmed     → resolve queue projections for document
 *
 * Architecture ref: office-operating-system.md §2.1 (queue catalog),
 *                   event-state-architecture.md §3.3 (document state machine).
 */

import type { Job } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
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
 * Escalation: 48h → notify assistant lead; 72h → responsible lawyer if known
 */
export async function handleIntakeRegistered(
  db: WorkersDb,
  job: DomainEventJob
): Promise<void> {
  const { payload, organizationId, eventId } = job.data

  if (!organizationId) return

  const intakeBundleId = payload['intakeBundleId'] as string | undefined
  const intakeBundleRef = (payload['ref'] as string | undefined) ?? 'entrada'
  const receivedAt = payload['receivedAt'] as string | undefined

  if (!intakeBundleId) return

  const slaDeadlineAt = intakeSlaDeadline()

  await upsertQueueProjection(db, {
    organizationId,
    queueType: 'intake_review',
    entityType: 'IntakeBundle',
    entityId: intakeBundleId,
    priority: 2,
    displayTitle: `Entrada: ${intakeBundleRef}`,
    displayLabel: 'intake_review',
    ...(receivedAt !== undefined ? { keyDate: new Date(receivedAt) } : {}),
    slaDeadlineAt,
    sourceCausingEventId: eventId,
    metadata: { intakeBundleRef },
  })

  await createIntakeTriageTask(db, {
    organizationId,
    intakeBundleId,
    intakeBundleRef,
    causingEventId: eventId,
  })
}

/**
 * Handles document.associated events.
 *
 * When a document is associated with a case and enters extraction_review status,
 * it enters the extraction_review queue.
 *
 * Per office-operating-system.md §2.1 (extraction_review queue):
 * Entry: Document status = extraction_review
 * SLA: 48h from extraction complete
 */
export async function handleDocumentAssociated(
  db: WorkersDb,
  job: DomainEventJob
): Promise<void> {
  const { payload, organizationId, eventId } = job.data

  if (!organizationId) return

  const documentId = payload['documentId'] as string | undefined
  const documentStatus = payload['newStatus'] as string | undefined
  const executionCaseId = payload['executionCaseId'] as string | undefined
  const documentClass = (payload['documentClass'] as string | undefined) ?? 'document'

  if (!documentId) return

  if (documentStatus === 'extraction_review') {
    const slaDeadlineAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

    await upsertQueueProjection(db, {
      organizationId,
      queueType: 'extraction_review',
      entityType: 'Document',
      entityId: documentId,
      ...(executionCaseId !== undefined ? { executionCaseId } : {}),
      priority: 2,
      displayTitle: `Extração para revisar: ${documentClass}`,
      displayLabel: documentClass,
      slaDeadlineAt,
      sourceCausingEventId: eventId,
      metadata: { documentClass },
    })
  }

  if (documentStatus === 'association_review' || documentStatus === 'pending_association') {
    await resolveQueueProjection(db, {
      organizationId,
      queueType: 'intake_review',
      entityType: 'Document',
      entityId: documentId,
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

  const documentId = payload['documentId'] as string | undefined
  if (!documentId) return

  for (const queueType of ['extraction_review', 'intake_review'] as const) {
    await resolveQueueProjection(db, {
      organizationId,
      queueType,
      entityType: 'Document',
      entityId: documentId,
    })
  }
}
