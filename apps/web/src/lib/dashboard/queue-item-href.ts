import type { QueueProjectionItem } from '@/lib/hooks/use-queue-projections'

/** Resolve operational deep-link for a queue projection item. */
export function queueProjectionHref(item: QueueProjectionItem): string | null {
  switch (item.entityType) {
    case 'Deadline':
      return `/deadlines/${item.entityId}`
    case 'Document':
      return `/documents/${item.entityId}`
    default:
      break
  }

  if (item.executionCaseId !== null) {
    return `/cases/${item.executionCaseId}`
  }

  return null
}
