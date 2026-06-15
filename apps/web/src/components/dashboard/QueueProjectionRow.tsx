import { text } from './surfaces'
import { QUEUE_TYPE_LABELS } from '@/lib/operational/queue-display'
import { ListCard, PriorityBadge } from '@/components/ui'
import { queueProjectionHref } from '@/lib/dashboard/queue-item-href'
import type { QueueProjectionItem } from '@/lib/hooks/use-queue-projections'

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso))
}

type QueueProjectionRowProps = {
  item: QueueProjectionItem
}

export function QueueProjectionRow({ item }: QueueProjectionRowProps) {
  const href = queueProjectionHref(item)

  return (
    <li>
      <ListCard variant="row" href={href ?? undefined}>
        {/* Coluna principal */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <PriorityBadge priority={item.priority} />
            <span className={`text-[11px] ${text.faint} truncate`}>
              {QUEUE_TYPE_LABELS[item.queueType] ?? item.queueType}
            </span>
          </div>
          <p className={`text-[13px] font-medium ${text.secondary} truncate`}>
            {item.displayTitle}
          </p>
          {(item.slaDeadlineAt !== null || item.keyDate !== null) && (
            <p className={`mt-0.5 text-[11px] ${text.faint}`}>
              {item.slaDeadlineAt !== null
                ? `Prazo: ${formatShortDate(item.slaDeadlineAt)}`
                : item.keyDate !== null
                  ? `Marco: ${formatShortDate(item.keyDate)}`
                  : null}
            </p>
          )}
        </div>
        {/* Coluna de data — alinhada à direita, tamanho fixo */}
        <div
          className={`shrink-0 self-start text-[11px] tabular-nums ${text.faint} pt-0.5`}
        >
          {formatShortDate(item.createdAt)}
        </div>
      </ListCard>
    </li>
  )
}
