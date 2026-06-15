/**
 * OCR run status — job lifecycle independent from documents.ocr_status.
 */
export const ocrRunStatusEnumValues = [
  'requested',
  'running',
  'completed',
  'failed',
] as const

export type OcrRunStatus = (typeof ocrRunStatusEnumValues)[number]

// Drizzle pgEnum is created in migration; re-export for schema typing via custom helper
import { pgEnum } from 'drizzle-orm/pg-core'

export const ocrRunStatusEnum = pgEnum('ocr_run_status', ocrRunStatusEnumValues)
