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
import { eq, and, desc } from '@execflow/db/client'
import { documents } from '@execflow/db/schema'
import { clearCaseStaleness } from '../integrations/autos-ingestion.ts'

const AUTOS_CLASSES = new Set(['autos_iniciais', 'autos_integral'])

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
 *
 * If the confirmed document is an autos class (autos_iniciais / autos_integral),
 * also:
 *   1. Sets supersedesDocumentId on the new doc (linking to previous confirmed autos).
 *   2. Marks the previous confirmed doc as 'superseded'.
 *   3. Clears case documentFreshnessStatus → 'fresh' (unblocks piece generation).
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

  // ── Autos versioning + freshness gate clearing
  try {
    const docRows = await db
      .select({
        id: documents.id,
        documentClass: documents.documentClass,
        executionCaseId: documents.executionCaseId,
      })
      .from(documents)
      .where(and(eq(documents.id, parsed.documentId), eq(documents.organizationId, organizationId)))
      .limit(1)

    const doc = docRows[0]
    if (!doc?.documentClass || !doc.executionCaseId) return
    if (!AUTOS_CLASSES.has(doc.documentClass)) return

    // Find the most recent previous confirmed autos doc of the same class
    const prevRows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.executionCaseId, doc.executionCaseId),
          eq(documents.documentClass, doc.documentClass),
          eq(documents.status, 'confirmed')
        )
      )
      .orderBy(desc(documents.confirmedAt))
      .limit(2) // limit 2: first is the new one just confirmed, second is the previous

    const prevDoc = prevRows.find((r) => r.id !== doc.id)

    if (prevDoc) {
      // Link new doc to previous + mark old as superseded
      await db
        .update(documents)
        .set({ supersedesDocumentId: prevDoc.id } as any)
        .where(eq(documents.id, doc.id))

      await db
        .update(documents)
        .set({ status: 'superseded' } as any)
        .where(eq(documents.id, prevDoc.id))
    }

    // Clear case staleness — new autos confirmed → case is fresh again
    await clearCaseStaleness(db, doc.executionCaseId)
  } catch (e) {
    // Never let versioning/freshness logic break the primary queue resolution
    console.warn('[intake-events] Falha no versioning de autos ou limpeza de frescor:', e)
  }
}
