/**
 * Extraction pipeline enums.
 */

import { pgEnum } from 'drizzle-orm/pg-core'

export const extractionRunStatusEnum = pgEnum('extraction_run_status', [
  'requested',
  'running',
  'review',
  'confirmed',
  'failed',
  'rejected',
])

export type ExtractionRunStatus = (typeof extractionRunStatusEnum.enumValues)[number]
