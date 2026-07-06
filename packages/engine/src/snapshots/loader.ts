/**
 * Snapshot loader — loads confirmed sentence and custody snapshots for evaluation.
 *
 * CONFIRMATION GATE: only loads rows with status='confirmed'.
 * Engine never reads proposed or superseded snapshots as primary input.
 * Architecture ref: execution-engine.md §0 (confirmed facts only),
 *                   data-model-v1.md §3.1, §3.2.
 *
 * TWO-CLOCK COMPLIANCE: uses effective_at (legal time) for ordering,
 * NOT recorded_at (system time). This is critical for correct temporal queries.
 * Architecture ref: execution-engine.md §0 (two clocks principle).
 */

import { eq, and, lte, isNotNull, desc } from '@execflow/db/client'
import type { AnyDbClient } from '@execflow/db/client'
import { sentenceSnapshots, custodySnapshots, timelineEvents } from '@execflow/db/schema'
import type {
  SentenceFacts,
  CustodyFacts,
  ActiveInterruption,
  RelevantTimelineEvent,
  CaseFacts,
} from '../types/index.ts'

const SNAPSHOT_STALENESS_DAYS = 180

export type LoadCaseFactsInput = {
  organizationId: string
  executionCaseId: string
  evaluatedAt: Date
}

/**
 * Loads all confirmed facts for a case at a given evaluation instant.
 * This is the primary entry point for building EvaluationContext inputs.
 */
export async function loadCaseFacts(
  db: AnyDbClient,
  input: LoadCaseFactsInput
): Promise<CaseFacts> {
  const { organizationId, executionCaseId, evaluatedAt } = input

  const [sentence, custody, interruptions, events, caseRecord] = await Promise.all([
    loadConfirmedSentenceSnapshot(db, executionCaseId, evaluatedAt),
    loadConfirmedCustodySnapshot(db, executionCaseId, evaluatedAt),
    loadActiveInterruptions(db, executionCaseId, evaluatedAt),
    loadRecentEvents(db, executionCaseId, evaluatedAt),
    loadExecutionCaseInfo(db, executionCaseId),
  ])

  // Determine staleness: snapshot is "recent" if within SNAPSHOT_STALENESS_DAYS
  const hasRecentConfirmedSnapshot =
    sentence !== null &&
    (evaluatedAt.getTime() - sentence.effectiveAt.getTime()) <
      SNAPSHOT_STALENESS_DAYS * 24 * 60 * 60 * 1000

  return {
    organizationId,
    executionCaseId,
    evaluatedAt,
    sentence,
    custody,
    activeInterruptions: interruptions,
    recentEvents: events,
    hasConfirmedProcessNumber: caseRecord.hasConfirmedProcessNumber,
    hasRecentConfirmedSnapshot,
  }
}

async function loadExecutionCaseInfo(
  db: AnyDbClient,
  executionCaseId: string
): Promise<{ hasConfirmedProcessNumber: boolean }> {
  // Use dynamic import to avoid circular dependency via db schema
  const { executionCases } = await import('@execflow/db/schema')
  const [row] = await db
    .select({ executionProcessNumber: executionCases.executionProcessNumber })
    .from(executionCases)
    .where(eq(executionCases.id, executionCaseId))
    .limit(1)

  return {
    hasConfirmedProcessNumber: row?.executionProcessNumber !== null && row?.executionProcessNumber !== undefined,
  }
}

async function loadConfirmedSentenceSnapshot(
  db: AnyDbClient,
  executionCaseId: string,
  asOf: Date
): Promise<SentenceFacts | null> {
  const [row] = await db
    .select()
    .from(sentenceSnapshots)
    .where(
      and(
        eq(sentenceSnapshots.executionCaseId, executionCaseId),
        eq(sentenceSnapshots.status, 'confirmed'),
        lte(sentenceSnapshots.effectiveAt, asOf)
      )
    )
    .orderBy(desc(sentenceSnapshots.effectiveAt))
    .limit(1)

  if (row === undefined) return null

  return {
    snapshotId: row.id,
    effectiveAt: row.effectiveAt,
    totalSentenceDays: row.totalSentenceDays,
    servedDays: row.servedDays,
    remissionDays: row.remissionDays,
    detractionDays: row.detractionDays,
    remainingDays: row.remainingDays,
    percentServed: String(row.percentServed),
    confidenceLevel: row.confidenceLevel as SentenceFacts['confidenceLevel'],
    missingDataFlags: Array.isArray(row.missingDataFlags)
      ? (row.missingDataFlags as Array<{ field: string; impact: 'high' | 'medium'; description: string }>)
      : [],
    playbookVersionId: row.playbookVersionId,
    crimesBreakdown: Array.isArray(row.crimesBreakdown) ? (row.crimesBreakdown as any[]) : [],
  }
}

async function loadConfirmedCustodySnapshot(
  db: AnyDbClient,
  executionCaseId: string,
  asOf: Date
): Promise<CustodyFacts | null> {
  const [row] = await db
    .select()
    .from(custodySnapshots)
    .where(
      and(
        eq(custodySnapshots.executionCaseId, executionCaseId),
        isNotNull(custodySnapshots.confirmedByUserId),
        lte(custodySnapshots.effectiveAt, asOf)
      )
    )
    .orderBy(desc(custodySnapshots.effectiveAt))
    .limit(1)

  if (row === undefined) return null

  return {
    snapshotId: row.id,
    effectiveAt: row.effectiveAt,
    regime: row.regime as CustodyFacts['regime'],
    prisonUnitId: row.prisonUnitId,
    confidence: row.confidence as CustodyFacts['confidence'],
  }
}

/**
 * Loads active interruptions from timeline events.
 * Interruptions that started before asOf and have not ended by asOf.
 * Architecture ref: execution-engine.md §1.7, §3.4.
 *
 * Simplified for Phase 7 foundation — full interruption tracking requires
 * the timeline event processor (future phase).
 */
async function loadActiveInterruptions(
  db: AnyDbClient,
  executionCaseId: string,
  asOf: Date
): Promise<ActiveInterruption[]> {
  // Load recent disciplinary and benefit-revocation events as interruption candidates
  const rows = await db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.executionCaseId, executionCaseId),
        lte(timelineEvents.occurredAt, asOf)
      )
    )
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(50)

  const interruptions: ActiveInterruption[] = []

  for (const event of rows) {
    const eventType = event.eventType as string

    // Fuga (escape) — creates full liberty interruption
    if (eventType === 'prison.escape' || eventType === 'custody.escape') {
      // Check if recapture event exists after this escape
      const hasRecapture = rows.some(
        (r: any) =>
          (r.eventType === 'prison.recapture' || r.eventType === 'custody.recapture') &&
          r.occurredAt > event.occurredAt
      )

      if (!hasRecapture) {
        interruptions.push({
          type: 'all_liberty',
          reason: 'Fuga — escape interruption active',
          since: event.occurredAt,
          resetsAccrual: true,
          sourceEventId: event.id,
        })
      }
    }

    // Disciplinary sanction — may create progression interruption
    if (eventType === 'disciplinary.sanction' || eventType === 'discipline.falta_grave') {
      // Simplified: assume interruption is active for now
      // Full lookback period comes from playbook in future phase
      interruptions.push({
        type: 'progression',
        reason: 'Falta grave — progressão sujeita a lookback',
        since: event.occurredAt,
        resetsAccrual: false, // determined by playbook; conservative default
        sourceEventId: event.id,
      })
      break // only track most recent sanction for Phase 7 foundation
    }
  }

  return interruptions
}

/**
 * Loads recent timeline events relevant to evaluation context.
 * Used by evaluators to check for pending incidents, hearings, etc.
 */
async function loadRecentEvents(
  db: AnyDbClient,
  executionCaseId: string,
  asOf: Date
): Promise<RelevantTimelineEvent[]> {
  const rows = await db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.executionCaseId, executionCaseId),
        lte(timelineEvents.occurredAt, asOf)
      )
    )
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(20)

  return rows.map((r: any) => ({
    eventId: r.id,
    eventType: r.eventType as string,
    occurredAt: r.occurredAt,
    category: r.eventCategory,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }))
}
