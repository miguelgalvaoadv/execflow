/**
 * Case Workspace read routes — case-scoped list endpoints.
 *
 * GET /api/v1/cases/:caseId/documents
 * GET /api/v1/cases/:caseId/opportunities
 * GET /api/v1/cases/:caseId/deadlines
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { toReadContext } from '../lib/read-context.ts'
import { PaginationQuerySchema } from '../lib/pagination-schemas.ts'
import { serviceErrorToResponse } from '../lib/route-helpers.ts'
import { unprocessable } from '../lib/respond.ts'
import {
  listCaseDocuments,
  listCaseOpportunities,
  listCaseDeadlines,
  listCaseSentenceSnapshots,
} from '../services/case-workspace-read.ts'
import type { HonoVariables } from '../context/types.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from '../services/result.ts'
import type { PaginatedListResponse } from '../services/case-workspace-read.ts'

const router = new Hono<{ Variables: HonoVariables }>()

const CaseIdParamSchema = z.object({
  caseId: z.string().uuid('Invalid case ID.'),
})

type ListFetcher<T> = (
  ctx: ReadContext,
  caseId: string,
  params: { limit: number; cursor?: string | undefined }
) => Promise<ServiceResult<PaginatedListResponse<T>>>

function createCaseListHandler<T>(fetcher: ListFetcher<T>) {
  return async (c: import('hono').Context<{ Variables: HonoVariables }>) => {
    const parsed = CaseIdParamSchema.safeParse({ caseId: c.req.param('caseId') })
    if (!parsed.success) {
      return unprocessable(c, 'Invalid case ID.', { issues: parsed.error.issues })
    }

    const queryParsed = PaginationQuerySchema.safeParse(c.req.query())
    if (!queryParsed.success) {
      return unprocessable(c, 'Invalid query parameters.', { issues: queryParsed.error.issues })
    }

    const ctx = toReadContext(buildWriteContext(c, db))
    const result = await fetcher(ctx, parsed.data.caseId, {
      limit: queryParsed.data.limit,
      ...(queryParsed.data.cursor !== undefined ? { cursor: queryParsed.data.cursor } : {}),
    })

    if (!result.success) {
      return serviceErrorToResponse(c, result.error)
    }

    return c.json({ data: result.data.items, nextCursor: result.data.nextCursor }, 200)
  }
}

router.get(
  '/:caseId/documents',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  createCaseListHandler(listCaseDocuments)
)

router.get(
  '/:caseId/opportunities',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  createCaseListHandler(listCaseOpportunities)
)

router.get(
  '/:caseId/deadlines',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  createCaseListHandler(listCaseDeadlines)
)

router.get(
  '/:caseId/sentence-snapshots',
  authMiddleware,
  orgMiddleware,
  requireMinRole('assistant'),
  createCaseListHandler(listCaseSentenceSnapshots)
)

export { router as caseWorkspaceReadRouter }
