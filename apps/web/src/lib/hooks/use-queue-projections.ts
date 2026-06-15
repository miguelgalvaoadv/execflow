/**
 * Queue projections hook — reads from GET /api/v1/queue-projections.
 *
 * Queue projections are READ-ONLY derived state: workers write them;
 * the frontend only consumes. No queue derivation logic lives here.
 *
 * Architecture ref: office-operating-system.md §2 (queue catalog),
 *                   event-state-architecture.md §4 (queue-event integration).
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type QueueProjectionItem = {
  id: string
  organizationId: string
  queueType: string
  entityType: string
  entityId: string
  executionCaseId: string | null
  status: string
  priority: number
  assigneeUserId: string | null
  displayTitle: string
  displayLabel: string | null
  keyDate: string | null
  slaDeadlineAt: string | null
  snoozedUntil: string | null
  sourceCausingEventId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

type QueueProjectionsResponse = {
  data: QueueProjectionItem[]
  count: number
  nextCursor: string | null
}

type UseQueueProjectionsOptions = {
  organizationId: string
  queueType?: string
  assigneeUserId?: string
  executionCaseId?: string
  limit?: number
  enabled?: boolean
}

export function useQueueProjections(opts: UseQueueProjectionsOptions) {
  const {
    organizationId,
    queueType,
    assigneeUserId,
    executionCaseId,
    limit = 50,
    enabled = true,
  } = opts

  return useQuery<QueueProjectionsResponse, ApiError>({
    queryKey: queryKeys.queueProjections(organizationId, {
      queueType,
      assigneeUserId,
      executionCaseId,
    }),
    queryFn: ({ signal }) =>
      apiGet<QueueProjectionsResponse>('/api/v1/queue-projections', {
        organizationId,
        signal,
        params: {
          queueType,
          assigneeUserId,
          executionCaseId,
          limit,
        },
      }),
    staleTime: 30 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}
