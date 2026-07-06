/**
 * Astrea Sealed Cases Routes — operational reminder panel for processos em
 * segredo de justiça. The Astrea integration cannot detect when a sealed
 * process's tribunal credential expires (no external signal exists for
 * that), so this is a human checklist, not an automation:
 *   1. needs_setup       → never configured in Astrea, highest priority
 *   2. possibly_expired  → lawyer flagged a suspected expired credential
 *   3. configured (overdue review) → past the 90-day review window
 *   4. configured (up to date)     → lowest priority
 *
 * Mounted at /api/v1/astrea
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { executionCases, clients } from '@execflow/db/schema'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const astreaSealedCasesRouter = new Hono<{ Variables: HonoVariables }>()

astreaSealedCasesRouter.use('*', authMiddleware, orgMiddleware)

const REVIEW_INTERVAL_DAYS = 90

type SealedCaseUrgency = 'needs_setup' | 'possibly_expired' | 'overdue' | 'ok'

function rankUrgency(status: string | null, reviewDueAt: Date | null): { urgency: SealedCaseUrgency; rank: number } {
  if (status === 'possibly_expired') return { urgency: 'possibly_expired', rank: 1 }
  if (!status || status === 'needs_setup') return { urgency: 'needs_setup', rank: 0 }
  if (reviewDueAt && reviewDueAt.getTime() < Date.now()) return { urgency: 'overdue', rank: 2 }
  return { urgency: 'ok', rank: 3 }
}

// ---------------------------------------------------------------------------
// GET /api/v1/astrea/sealed-cases — sealed cases ranked by urgency
// ---------------------------------------------------------------------------

astreaSealedCasesRouter.get('/sealed-cases', requireMinRole('assistant'), async (c) => {
  const { organization } = c.get('org')

  const rows = await db
    .select({ case: executionCases, client: clients })
    .from(executionCases)
    .innerJoin(clients, eq(executionCases.clientId, clients.id))
    .where(and(eq(executionCases.organizationId, organization.id), eq(executionCases.monitoringStatus, 'sealed')))

  const ranked = rows
    .map((r) => {
      const { urgency, rank } = rankUrgency(r.case.astreaSealedCredentialStatus, r.case.astreaSealedCredentialReviewDueAt)
      return {
        executionCaseId: r.case.id,
        internalRef: r.case.internalRef,
        executionProcessNumber: r.case.executionProcessNumber,
        clientName: r.client.fullName,
        astreaSealedCredentialStatus: r.case.astreaSealedCredentialStatus,
        astreaSealedCredentialUpdatedAt: r.case.astreaSealedCredentialUpdatedAt,
        astreaSealedCredentialReviewDueAt: r.case.astreaSealedCredentialReviewDueAt,
        lastSyncedAt: r.case.lastSyncedAt,
        urgency,
        rank,
      }
    })
    .sort((a, b) => a.rank - b.rank)

  return c.json({ data: ranked })
})

// ---------------------------------------------------------------------------
// POST /api/v1/astrea/sealed-cases/:caseId/mark-verified
// ---------------------------------------------------------------------------

const MarkVerifiedSchema = z.object({
  status: z.enum(['configured', 'needs_setup', 'possibly_expired']).default('configured'),
})

astreaSealedCasesRouter.post('/sealed-cases/:caseId/mark-verified', requireMinRole('lawyer'), async (c) => {
  const caseId = c.req.param('caseId')
  const { organization } = c.get('org')

  const body = await c.req.json().catch(() => ({}))
  const parsed = MarkVerifiedSchema.safeParse(body)
  if (!parsed.success) {
    return unprocessable(c, 'Corpo inválido.', { issues: parsed.error.issues })
  }

  const [execCase] = await db
    .select()
    .from(executionCases)
    .where(and(eq(executionCases.id, caseId), eq(executionCases.organizationId, organization.id)))
    .limit(1)

  if (!execCase) {
    return unprocessable(c, 'Caso não encontrado nesta organização.')
  }

  const now = new Date()
  const reviewDueAt =
    parsed.data.status === 'configured'
      ? new Date(now.getTime() + REVIEW_INTERVAL_DAYS * 24 * 60 * 60 * 1000)
      : null

  await db
    .update(executionCases)
    .set({
      astreaSealedCredentialStatus: parsed.data.status,
      astreaSealedCredentialUpdatedAt: now,
      astreaSealedCredentialReviewDueAt: reviewDueAt,
    })
    .where(eq(executionCases.id, caseId))

  return c.json({ data: { status: parsed.data.status, reviewDueAt } })
})
