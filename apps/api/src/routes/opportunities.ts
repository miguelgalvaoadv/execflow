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

const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const

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

export { router as opportunitiesRouter }
