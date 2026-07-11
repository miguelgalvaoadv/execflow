/**
 * TimelineEvent repository — APPEND-ONLY data access.
 *
 * APPEND-ONLY CONTRACT:
 * - This repository exposes NO update method.
 * - This repository exposes NO delete method.
 * - appendTimelineEvent() is the ONLY write operation.
 * - Corrections produce new events with amendsEventId set.
 *
 * Architecture ref: data-model-v1.md §2.5 (TimelineEvent immutability),
 *                   ENGINEERING_PRINCIPLES.md §2 (append-only legal history).
 *
 * REPLAY-SAFE INSERTION ORDER:
 * Events are inserted with explicit recordedAt = NOW() (set by DB default).
 * Callers set occurredAt to the legal time. This preserves the two-clock principle.
 *
 * QUERY PATTERN:
 * Reads return events ordered by occurredAt DESC (most recent legal event
 * first — achado 08/07/2026: a ordem ASC fazia a tela sempre mostrar os 50
 * eventos MAIS ANTIGOS do caso; num caso com 84 eventos, a movimentação real
 * mais recente nunca chegava nem perto do limite de 50 e nunca aparecia na
 * tela, não importa quantas vezes o advogado sincronizasse ou recarregasse).
 * Paginação "carregar mais" (cursor) anda pro passado a partir do evento
 * mais antigo já mostrado — ver comentário em queryTimelineEvents().
 * For replay queries, use the compound (recorded_at, occurred_at) index.
 */

import { eq, and, desc, lt, inArray } from 'drizzle-orm'
import { timelineEvents, timelineEventCategoryEnum } from '@execflow/db/schema'
import type { TimelineEvent, NewTimelineEvent } from '@execflow/db/schema'

type TimelineEventCategory = (typeof timelineEventCategoryEnum.enumValues)[number]
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginatedResult, PaginationParams } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Query timeline events for a case, most recent first (occurred_at DESC) —
 * o que o advogado quer ver é o que aconteceu agora, não o evento mais
 * antigo do processo. Paginado ("carregar mais" anda pro passado a partir
 * do cursor) — nunca retorna tudo sem limite.
 * Filters: only shows non-amended events (amendsEventId IS NULL) by default.
 *
 * Architecture ref: ENGINEERING_PRINCIPLES.md §11 (paginated list queries).
 */
export async function queryTimelineEvents(
  db: AnyTx,
  organizationId: string,
  executionCaseId: string,
  params: PaginationParams & {
    visibilityFilter?: Array<'legal' | 'internal' | 'both'>
    eventCategoryFilter?: TimelineEventCategory[]
  }
): Promise<RepositoryResult<PaginatedResult<TimelineEvent>>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)

    const visibilityCondition =
      params.visibilityFilter !== undefined && params.visibilityFilter.length > 0
        ? inArray(timelineEvents.visibility, params.visibilityFilter)
        : undefined

    const categoryCondition =
      params.eventCategoryFilter !== undefined && params.eventCategoryFilter.length > 0
        ? inArray(timelineEvents.eventCategory, params.eventCategoryFilter)
        : undefined

    const rows = await db.query.timelineEvents.findMany({
      where: and(
        eq(timelineEvents.organizationId, organizationId),
        eq(timelineEvents.executionCaseId, executionCaseId),
        params.cursor
          ? lt(timelineEvents.occurredAt, new Date(params.cursor))
          : undefined,
        visibilityCondition,
        categoryCondition
      ),
      orderBy: [desc(timelineEvents.occurredAt)],
      limit: limit + 1, // fetch one extra to determine if there's a next page
    })

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1]!.occurredAt.toISOString()
        : null

    return {
      success: true,
      data: {
        items,
        nextCursor,
        totalCount: items.length, // approximate for timeline; exact count is expensive
      },
    }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query timeline events.', cause: err },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations (append-only)
// ---------------------------------------------------------------------------

/**
 * Append an immutable timeline event.
 * Must be called inside a transaction.
 * After this call, the row cannot be modified or deleted.
 *
 * REPLAY SAFETY: recordedAt is set by the DB default (NOW()), ensuring
 * the system ingestion time is always accurate regardless of what occurredAt contains.
 */
export async function appendTimelineEvent(
  tx: DbTransaction,
  data: NewTimelineEvent
): Promise<RepositoryResult<TimelineEvent>> {
  try {
    const [row] = await tx.insert(timelineEvents).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Timeline event append returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to append timeline event.', cause: err },
    }
  }
}
