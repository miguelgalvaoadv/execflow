/**
 * Shared Zod schemas for cursor-based list query parameters.
 */

import { z } from 'zod'

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>
