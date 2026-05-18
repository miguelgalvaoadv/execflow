/**
 * Timeline routes — POST /api/v1/cases/:caseId/timeline
 *
 * The timeline is append-only. No edit or delete endpoints exist.
 * Corrections are new events with amendsEventId pointing to the error.
 *
 * Authorization:
 * - Append: assistant+ (operational notes, document associations)
 * - Legal annotations (court.*, sentence.*): lawyer+ enforced at service layer
 *   via event category validation in Phase 5+ (not yet in Phase 4)
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
import { appendTimelineEntry } from '../services/timeline.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

const router = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// POST /api/v1/cases/:caseId/timeline — Append a timeline event
// -------------------------------------------------------------------------

const AppendTimelineEventSchema = z.object({
  /**
   * Fine-grained event type. Dot-namespaced free text.
   * Examples: 'office.note', 'prison.transfer', 'court.hearing', 'document.registered'
   */
  eventType: z.string().min(1).max(100),

  /**
   * Broad event category. Must match timeline_event_category enum.
   */
  eventCategory: z.enum([
    'court',
    'prison',
    'sentence',
    'benefit',
    'legal_action',
    'document',
    'ai',
    'internal',
    'system',
  ]),

  /**
   * LEGAL TIME: when this event actually occurred.
   * May be in the past for retroactive recording.
   * Required. ISO 8601 datetime.
   */
  occurredAt: z.string().min(1, 'occurredAt (legal time) is required'),

  /**
   * Human-readable summary. Required.
   */
  summary: z.string().min(1, 'summary is required').max(5000),

  /**
   * Event-type specific structured payload.
   * Optional. Stored as opaque JSON; validated against playbook schema in Phase 5+.
   */
  payload: z.record(z.string(), z.unknown()).optional(),

  /** Event origin. Default: 'manual'. */
  source: z
    .enum(['manual', 'document', 'integration', 'ai_suggestion', 'system_rule'])
    .optional(),

  /**
   * Visibility control.
   * 'internal': office-only. 'legal': court-facing. 'both': both.
   * Default: 'internal'.
   */
  visibility: z.enum(['legal', 'internal', 'both']).optional(),

  /**
   * UUID of the event this corrects (for amendment events).
   * The corrected event is NOT deleted — both remain in history.
   */
  amendsEventId: z.string().uuid().optional(),

  /** Polymorphic source reference. */
  sourceRefType: z.string().max(100).optional(),
  sourceRefId: z.string().uuid().optional(),
})

router.post(
  '/:caseId/timeline',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  async (c) => {
    const caseId = c.req.param('caseId')

    const body = await safeJsonBody(c)
    if (body === null) {
      return unprocessable(c, 'Request body must be valid JSON.')
    }

    const parsed = parseBody(AppendTimelineEventSchema, body)
    if (!parsed.success) {
      return unprocessable(c, parsed.message, parsed.issues)
    }

    const ctx = buildWriteContext(c, db)
    const result = await appendTimelineEntry(ctx, {
      executionCaseId: caseId,
      ...parsed.data,
    })

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data }, 201)
  }
)

export { router as timelineRouter }
