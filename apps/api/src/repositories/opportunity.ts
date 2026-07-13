/**
 * Opportunity repository — data access layer for the opportunities table.
 *
 * State machine enforcement is in the service layer, not here.
 * This repository is a pure data access layer.
 *
 * IMMUTABLE FIELDS: id, organization_id, execution_case_id, opportunity_type,
 *   detected_at, created_at, created_by_user_id. Never included in update methods.
 */

import { eq, and, desc, asc, lt, ilike, or, isNull, sql } from 'drizzle-orm'
import { opportunities, executionCases, clients } from '@execflow/db/schema'
import type { Opportunity, NewOpportunity } from '@execflow/db/schema'
import type { OpportunityStatus } from '@execflow/db/types'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult, PaginationParams, PaginatedResult } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Find an opportunity by primary key, scoped to the organization.
 */
export async function findOpportunityById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<Opportunity>> {
  try {
    const row = await db.query.opportunities.findFirst({
      where: and(
        eq(opportunities.id, id),
        eq(opportunities.organizationId, organizationId)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Opportunity not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query opportunity.', cause: err },
    }
  }
}

/**
 * List opportunities for an execution case, most recently detected first.
 */
export async function listOpportunitiesByCase(
  db: AnyTx,
  organizationId: string,
  executionCaseId: string,
  params: PaginationParams
): Promise<RepositoryResult<PaginatedResult<Opportunity>>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)

    const rows = await db.query.opportunities.findMany({
      where: and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.executionCaseId, executionCaseId),
        params.cursor !== undefined ? lt(opportunities.detectedAt, new Date(params.cursor)) : undefined
      ),
      orderBy: [desc(opportunities.detectedAt), desc(opportunities.id)],
      limit: limit + 1,
    })

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items[items.length - 1]
    const nextCursor =
      hasMore && last !== undefined ? last.detectedAt.toISOString() : null

    return {
      success: true,
      data: { items, nextCursor, totalCount: items.length },
    }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list opportunities for case.', cause: err },
    }
  }
}

export type OpportunityOrgListItem = {
  id: string
  opportunityType: string
  status: string
  summary: string
  confidenceLevel: string | null
  detectedAt: Date
  windowEndAt: Date | null
  executionCaseId: string
  caseInternalRef: string | null
  clientName: string | null
  processNumber: string | null
}

export type ListOpportunitiesForOrgFilters = {
  status?: string
  opportunityType?: string
  q?: string
}

function parseOpportunityOrgListCursor(cursor: string): { id: string } | null {
  const separator = cursor.indexOf('|')
  const id = separator > 0 ? cursor.slice(separator + 1) : cursor
  if (id === '' || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return { id }
}

function encodeOpportunityOrgListCursor(detectedAt: Date, id: string): string {
  return `${detectedAt.toISOString()}|${id}`
}

/** Sentinel bem no futuro pra tratar windowEndAt=NULL como "sem urgência" na ordenação — ver abaixo. */
const NO_WINDOW_SENTINEL = sql`'9999-12-31 00:00:00+00'::timestamptz`

/**
 * Org-wide opportunity list — the firm-wide triage view ("all suggested
 * opportunities across every case"). Achado 13/07/2026 (pedido do Miguel):
 * antes ordenava por detectedAt DESC (mais recente primeiro) — não dizia
 * nada sobre o que fazer primeiro. Agora ordena por URGÊNCIA: quem tem
 * janela de prazo (windowEndAt) mais próxima de fechar vem primeiro; quem
 * não tem janela definida (windowEndAt null — comum, é campo opcional) vai
 * pro final, ordenado por detectada-há-mais-tempo primeiro (pra não
 * esquecer as mais antigas). COALESCE com sentinela no futuro em vez de
 * NULLS LAST porque a paginação por keyset abaixo precisa comparar tuplas
 * sem NULL no meio (NULL quebra comparação de tupla em SQL).
 *
 * Achado 08/07/2026: esse endpoint nunca existiu — a tela /opportunities do
 * front dependia de queue_projections, que só é alimentada pelo fluxo de
 * extraction-promotion (e-mail/scan), nunca por analyzeAutosForCase. Um
 * advogado nunca via, no painel geral, oportunidades geradas pela IA.
 */
export async function listOpportunitiesForOrg(
  db: AnyTx,
  organizationId: string,
  filters: ListOpportunitiesForOrgFilters,
  params: PaginationParams
): Promise<RepositoryResult<{ items: OpportunityOrgListItem[]; nextCursor: string | null }>> {
  try {
    const limit = Math.min(params.limit ?? 50, 200)
    const conditions = [eq(opportunities.organizationId, organizationId)]

    if (filters.status !== undefined) {
      conditions.push(eq(opportunities.status, filters.status as Opportunity['status']))
    }

    if (filters.opportunityType !== undefined) {
      conditions.push(eq(opportunities.opportunityType, filters.opportunityType as Opportunity['opportunityType']))
    }

    const q = filters.q?.trim()
    if (q !== undefined && q.length > 0) {
      const pattern = `%${q}%`
      conditions.push(
        or(
          ilike(opportunities.summary, pattern),
          ilike(executionCases.internalRef, pattern),
          ilike(clients.fullName, pattern)
        )!
      )
    }

    if (params.cursor !== undefined) {
      const parsed = parseOpportunityOrgListCursor(params.cursor)
      if (parsed === null) {
        return {
          success: false,
          error: { code: 'CONSTRAINT', message: 'Invalid pagination cursor.' },
        }
      }
      conditions.push(
        sql`(COALESCE(${opportunities.windowEndAt}, ${NO_WINDOW_SENTINEL}), ${opportunities.detectedAt}, ${opportunities.id}) > (
          SELECT COALESCE(window_end_at, ${NO_WINDOW_SENTINEL}), detected_at, id FROM opportunities
          WHERE id = ${parsed.id}::uuid AND organization_id = ${organizationId}
        )`
      )
    }

    const rows = await db
      .select({
        id: opportunities.id,
        opportunityType: opportunities.opportunityType,
        status: opportunities.status,
        summary: opportunities.summary,
        confidenceLevel: opportunities.confidenceLevel,
        detectedAt: opportunities.detectedAt,
        windowEndAt: opportunities.windowEndAt,
        executionCaseId: opportunities.executionCaseId,
        caseInternalRef: executionCases.internalRef,
        clientName: clients.fullName,
        processNumber: executionCases.executionProcessNumber,
      })
      .from(opportunities)
      .innerJoin(
        executionCases,
        and(
          eq(opportunities.executionCaseId, executionCases.id),
          eq(executionCases.organizationId, organizationId),
          isNull(executionCases.deletedAt)
        )
      )
      .innerJoin(clients, eq(executionCases.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(
        asc(sql`COALESCE(${opportunities.windowEndAt}, ${NO_WINDOW_SENTINEL})`),
        asc(opportunities.detectedAt),
        asc(opportunities.id)
      )
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const nextCursor =
      hasMore && page.length > 0
        ? encodeOpportunityOrgListCursor(page[page.length - 1]!.detectedAt, page[page.length - 1]!.id)
        : null

    return { success: true, data: { items: page, nextCursor } }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to list opportunities for organization.', cause: err },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert a new opportunity.
 * Must be called inside a transaction.
 */
export async function insertOpportunity(
  tx: DbTransaction,
  data: NewOpportunity
): Promise<RepositoryResult<Opportunity>> {
  try {
    const [row] = await tx.insert(opportunities).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Opportunity insert returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert opportunity.', cause: err },
    }
  }
}

/**
 * Transition an opportunity's status.
 * Also updates qualification/dismissal/expiry timestamps and related fields.
 * The service layer enforces valid transitions before calling this.
 */
export async function updateOpportunityStatus(
  tx: DbTransaction,
  organizationId: string,
  opportunityId: string,
  params: {
    status: OpportunityStatus
    qualifiedAt?: Date | undefined
    qualifiedByUserId?: string | undefined
    dismissedAt?: Date | undefined
    dismissedByUserId?: string | undefined
    dismissedReason?: string | undefined
    expiredAt?: Date | undefined
    realizedPieceDraftId?: string | undefined
    isPendingReview?: boolean | undefined
    updatedAt: Date
  }
): Promise<RepositoryResult<Opportunity>> {
  try {
    const [row] = await tx
      .update(opportunities)
      .set({
        status: params.status,
        ...(params.qualifiedAt !== undefined ? { qualifiedAt: params.qualifiedAt } : {}),
        ...(params.qualifiedByUserId !== undefined ? { qualifiedByUserId: params.qualifiedByUserId } : {}),
        ...(params.dismissedAt !== undefined ? { dismissedAt: params.dismissedAt } : {}),
        ...(params.dismissedByUserId !== undefined ? { dismissedByUserId: params.dismissedByUserId } : {}),
        ...(params.dismissedReason !== undefined ? { dismissedReason: params.dismissedReason } : {}),
        ...(params.expiredAt !== undefined ? { expiredAt: params.expiredAt } : {}),
        ...(params.realizedPieceDraftId !== undefined ? { realizedPieceDraftId: params.realizedPieceDraftId } : {}),
        ...(params.isPendingReview !== undefined ? { isPendingReview: params.isPendingReview } : {}),
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Opportunity not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update opportunity status.', cause: err },
    }
  }
}

/**
 * Update queue compatibility flags (pending review, blocked, stale).
 * Called by services and engine integration points.
 */
export async function updateOpportunityFlags(
  tx: DbTransaction,
  organizationId: string,
  opportunityId: string,
  params: {
    requiresReview?: boolean | undefined
    isPendingReview?: boolean | undefined
    isBlocked?: boolean | undefined
    isStale?: boolean | undefined
    blockingConditions?: unknown
    updatedAt: Date
  }
): Promise<RepositoryResult<Opportunity>> {
  try {
    const [row] = await tx
      .update(opportunities)
      .set({
        ...(params.requiresReview !== undefined ? { requiresReview: params.requiresReview } : {}),
        ...(params.isPendingReview !== undefined ? { isPendingReview: params.isPendingReview } : {}),
        ...(params.isBlocked !== undefined ? { isBlocked: params.isBlocked } : {}),
        ...(params.isStale !== undefined ? { isStale: params.isStale } : {}),
        ...(params.blockingConditions !== undefined ? { blockingConditions: params.blockingConditions } : {}),
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Opportunity not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update opportunity flags.', cause: err },
    }
  }
}
