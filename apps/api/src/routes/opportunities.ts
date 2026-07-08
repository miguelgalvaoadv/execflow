/**
 * Opportunity routes
 *
 * POST   /api/v1/opportunities            — create opportunity (lawyer+)
 * POST   /api/v1/opportunities/:id/review — review opportunity (lawyer+)
 * POST   /api/v1/opportunities/:id/defer  — defer opportunity (lawyer+)
 *
 * LAWYER-ONLY RATIONALE:
 * Opportunities concern procedural advantages that may affect liberty (progressão, HC, etc.).
 * Creating, reviewing, and deferring opportunities requires a lawyer's judgment.
 * AI_BOUNDARIES.md: "No autonomous filing, no autonomous benefit requests."
 *
 * EXPLANATION MANDATORY:
 * All review actions require an explanation. Validated in the service layer;
 * the route layer checks the field is present but length enforcement is in the service.
 *
 * Architecture ref: execution-workflows.md §5, data-model-v1.md §2.9.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { serviceErrorToResponse, safeJsonBody } from '../lib/route-helpers.ts'
import { unprocessable } from '../lib/respond.ts'
import {
  createOpportunity,
  reviewOpportunity,
  deferOpportunity,
} from '../services/opportunity.ts'
import { listOpportunitiesForOrg } from '../services/opportunity-read.ts'
import { findOpportunityById } from '../repositories/opportunity.ts'
import { queryOpportunityReviews } from '../repositories/opportunity-review.ts'
import { toReadContext } from '../lib/read-context.ts'
import { PaginationQuerySchema } from '../lib/pagination-schemas.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// Validation schemas
// -------------------------------------------------------------------------

const OPPORTUNITY_TYPES = [
  'progression', 'remission', 'detraction', 'amnesty', 'commutation',
  'hc', 'pad_challenge', 'prescription', 'recalculation',
  'excess_execution', 'rights_violation', 'manual',
] as const

const OPPORTUNITY_STATUSES = [
  'suggested', 'qualified', 'pursuing', 'realized', 'dismissed', 'expired',
] as const

const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const

const ListOpportunitiesQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  opportunityType: z.enum(OPPORTUNITY_TYPES).optional(),
  q: z.string().max(200).optional(),
})

// -------------------------------------------------------------------------
// GET /api/v1/opportunities — Paginated org opportunity list
// -------------------------------------------------------------------------

router.get(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const parsed = ListOpportunitiesQuerySchema.safeParse(c.req.query())
    if (!parsed.success) {
      return unprocessable(c, 'Invalid query parameters.', { issues: parsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const q = parsed.data

    const result = await listOpportunitiesForOrg(
      ctx,
      {
        ...(q.status !== undefined ? { status: q.status } : {}),
        ...(q.opportunityType !== undefined ? { opportunityType: q.opportunityType } : {}),
        ...(q.q !== undefined ? { q: q.q } : {}),
      },
      {
        limit: q.limit,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      }
    )

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data.items, nextCursor: result.data.nextCursor }, 200)
  }
)

const UncertaintyFlagSchema = z.object({
  factor: z.string().min(1).max(200),
  impact: z.enum(['high', 'medium', 'low']),
  description: z.string().min(1).max(1000),
})

const BlockingConditionSchema = z.object({
  condition: z.string().min(1).max(500),
  type: z.enum(['missing_data', 'pending_review', 'dependency']),
  entityRef: z.string().optional(),
})

const RequiredDocumentSchema = z.object({
  required: z.string().min(1).max(300),
  reason: z.string().min(1).max(500),
  urgency: z.enum(['required', 'recommended']),
})

const MissingDataFieldSchema = z.object({
  field: z.string().min(1).max(200),
  source: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
})

const CreateOpportunitySchema = z.object({
  executionCaseId: z.string().uuid('executionCaseId must be a valid UUID'),
  opportunityType: z.enum(OPPORTUNITY_TYPES),
  summary: z.string().min(1, 'Summary is required').max(2000),
  rationale: z.string().max(10000).optional(),
  confidenceLevel: z.enum(CONFIDENCE_LEVELS).optional(),
  windowStartAt: z.string().datetime({ offset: true }).optional(),
  windowEndAt: z.string().datetime({ offset: true }).optional(),
  legalBasis: z.string().max(2000).optional(),
  sentenceSnapshotId: z.string().uuid().optional(),
  sourceEventId: z.string().uuid().optional(),
  playbookVersionId: z.string().uuid().optional(),
  blockingConditions: z.array(BlockingConditionSchema).max(20).optional(),
  requiredDocuments: z.array(RequiredDocumentSchema).max(20).optional(),
  missingDataFields: z.array(MissingDataFieldSchema).max(20).optional(),
  uncertaintyFlags: z.array(UncertaintyFlagSchema).max(20).optional(),
  requiresReview: z.boolean().optional(),
})

const REVIEW_ACTIONS = [
  'qualified', 'rejected', 'changes_requested', 'deferred', 'escalated',
  'pursuing_started', 'realized',
] as const

const ReviewOpportunitySchema = z.object({
  reviewAction: z.enum(REVIEW_ACTIONS),
  /**
   * Mandatory for all review actions. Explains the rationale for the decision.
   * Minimum length 10 chars to discourage placeholder explanations.
   */
  explanation: z.string().min(10, 'Explanation must be at least 10 characters.').max(10000),
  rejectionReasonCode: z.enum([
    'not_applicable', 'data_insufficient', 'timing_not_met',
    'prior_dismissal', 'superseded', 'other',
  ]).optional(),
  deferredUntil: z.string().datetime({ offset: true }).optional(),
  escalatedToUserId: z.string().uuid().optional(),
  realizedPieceDraftId: z.string().uuid().optional(),
  dataSnapshotRef: z.record(z.string(), z.unknown()).optional(),
})

const DeferOpportunitySchema = z.object({
  deferredUntil: z.string().datetime({ offset: true, message: 'deferredUntil must be a valid ISO 8601 datetime' }),
  explanation: z.string().min(10, 'Explanation must be at least 10 characters.').max(10000),
})

// -------------------------------------------------------------------------
// POST /api/v1/opportunities — Create an opportunity
// -------------------------------------------------------------------------

router.post(
  '/',
  authMiddleware,
  orgMiddleware,
  requireMinRole('lawyer'),
  async (c) => {
    const body = await safeJsonBody(c)
    if (body === null) return unprocessable(c, 'Request body must be valid JSON.')

    const parsed = parseBody(CreateOpportunitySchema, body)
    if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

    const ctx = buildWriteContext(c, db)
    const result = await createOpportunity(ctx, parsed.data)

    if (!result.success) return serviceErrorToResponse(c, result.error)
    return c.json({ data: result.data }, 201)
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/opportunities/:id/review — Review an opportunity
// -------------------------------------------------------------------------

/**
 * Central review endpoint for all review actions.
 * reviewAction determines what happens to the opportunity's status.
 *
 * Lawyer-only: ALL transitions require lawyer authority.
 * The service additionally validates the transition is valid from the current state.
 */
router.post(
  '/:id/review',
  authMiddleware,
  orgMiddleware,
  requireMinRole('lawyer'),
  async (c) => {
    const opportunityId = c.req.param('id')
    if (!opportunityId?.match(/^[0-9a-f-]{36}$/i)) {
      return unprocessable(c, 'Invalid opportunity ID format.')
    }

    const body = await safeJsonBody(c)
    if (body === null) return unprocessable(c, 'Request body must be valid JSON.')

    const parsed = parseBody(ReviewOpportunitySchema, body)
    if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

    const ctx = buildWriteContext(c, db)
    const result = await reviewOpportunity(ctx, opportunityId, parsed.data)

    if (!result.success) return serviceErrorToResponse(c, result.error)
    return c.json({ data: result.data })
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/opportunities/:id/defer — Defer an opportunity
// -------------------------------------------------------------------------

/**
 * Convenience endpoint for deferring.
 * Internally delegates to reviewOpportunity with action='deferred'.
 * Provides a cleaner API than sending reviewAction in the body.
 */
router.post(
  '/:id/defer',
  authMiddleware,
  orgMiddleware,
  requireMinRole('lawyer'),
  async (c) => {
    const opportunityId = c.req.param('id')
    if (!opportunityId?.match(/^[0-9a-f-]{36}$/i)) {
      return unprocessable(c, 'Invalid opportunity ID format.')
    }

    const body = await safeJsonBody(c)
    if (body === null) return unprocessable(c, 'Request body must be valid JSON.')

    const parsed = parseBody(DeferOpportunitySchema, body)
    if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

    const ctx = buildWriteContext(c, db)
    const result = await deferOpportunity(ctx, opportunityId, parsed.data)

    if (!result.success) return serviceErrorToResponse(c, result.error)
    return c.json({ data: result.data })
  }
)

// -------------------------------------------------------------------------
// GET /api/v1/opportunities/:id/reviews — List review history
// -------------------------------------------------------------------------
router.get(
  '/:id/reviews',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const opportunityId = c.req.param('id')
    if (!opportunityId?.match(/^[0-9a-f-]{36}$/i)) {
      return unprocessable(c, 'Invalid opportunity ID format.')
    }

    const ctx = buildWriteContext(c, db)
    const oppResult = await findOpportunityById(db, ctx.organizationId, opportunityId)
    if (!oppResult.success) {
      return c.json({ error: 'Opportunity not found.' }, 404)
    }

    const result = await queryOpportunityReviews(db, opportunityId)
    if (!result.success) {
      return c.json({ error: 'Failed to fetch reviews.' }, 500)
    }

    return c.json({ data: result.data })
  }
)

// -------------------------------------------------------------------------
// POST /api/v1/opportunities/:id/create-task — transformar em tarefa
// -------------------------------------------------------------------------
//
// REGRA (spec §4): oportunidade NUNCA vira tarefa automaticamente.
// Só oportunidade já VALIDADA pelo advogado (qualified/pursuing) pode virar
// tarefa — 'suggested' é rejeitada com instrução explícita de validar antes.

const CreateTaskFromOpportunitySchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional(),
  dueAt: z.string().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  assignedToUserId: z.string().uuid().optional(),
})

router.post(
  '/:id/create-task',
  authMiddleware,
  orgMiddleware,
  requireMinRole('lawyer'),
  async (c) => {
    const opportunityId = c.req.param('id')
    if (!opportunityId?.match(/^[0-9a-f-]{36}$/i)) {
      return unprocessable(c, 'Invalid opportunity ID format.')
    }

    const body = await safeJsonBody(c)
    const parsed = parseBody(CreateTaskFromOpportunitySchema, body ?? {})
    if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

    const ctx = buildWriteContext(c, db)
    const oppResult = await findOpportunityById(db, ctx.organizationId, opportunityId)
    if (!oppResult.success) {
      return c.json({ error: 'Opportunity not found.' }, 404)
    }
    const opp = oppResult.data

    if (opp.status === 'suggested') {
      return unprocessable(
        c,
        'Oportunidade ainda não validada. Valide (qualifique) a oportunidade antes de transformá-la em tarefa — sugestões da IA não viram tarefa automaticamente.'
      )
    }
    if (opp.status === 'dismissed' || opp.status === 'expired' || opp.status === 'realized') {
      return unprocessable(
        c,
        `Oportunidade em estado terminal ('${opp.status}') não pode virar tarefa.`
      )
    }

    const { workflowTasks } = await import('@execflow/db/schema')
    const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : (opp.windowEndAt ?? null)

    const [task] = await db
      .insert(workflowTasks)
      .values({
        organizationId: ctx.organizationId,
        taskType: 'prepare_piece',
        title: parsed.data.title ?? `Preparar peça: ${opp.summary.substring(0, 200)}`,
        description:
          parsed.data.description ??
          `Tarefa criada a partir de oportunidade validada.\n\nFundamento: ${opp.rationale ?? opp.summary}`,
        priority: parsed.data.priority ?? 'high',
        executionCaseId: opp.executionCaseId,
        sourceEntityType: 'Opportunity',
        sourceEntityId: opp.id,
        requiresReview: true,
        dueAt,
        assignedToUserId: parsed.data.assignedToUserId ?? null,
        assignedByUserId: parsed.data.assignedToUserId ? ctx.userId : null,
        assignedAt: parsed.data.assignedToUserId ? new Date() : null,
        createdByUserId: ctx.userId,
        taskMetadata: { opportunityId: opp.id, opportunityType: opp.opportunityType ?? null },
      })
      .returning()

    return c.json({ data: task }, 201)
  }
)

export { router as opportunitiesRouter }
