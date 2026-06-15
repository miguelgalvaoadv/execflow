import { PRIORITY_LABELS } from '@/lib/operational/queue-display'
import {
  deadlinePriorityBadgeClass,
  deadlinePriorityLabel,
} from '@/lib/operational/deadline-display'

const BASE_CLASS =
  'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase'

type PriorityBadgeQueueProps = {
  variant?: 'queue'
  priority: number
  className?: string
}

type PriorityBadgeDeadlineProps = {
  variant: 'deadline'
  priority: string
  className?: string
}

export type PriorityBadgeProps = PriorityBadgeQueueProps | PriorityBadgeDeadlineProps

export function PriorityBadge(props: PriorityBadgeProps) {
  if (props.variant === 'deadline') {
    return (
      <span
        className={[
          BASE_CLASS,
          'tracking-[0.1em]',
          deadlinePriorityBadgeClass(props.priority),
          props.className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {deadlinePriorityLabel(props.priority)}
      </span>
    )
  }

  const priorityMeta = PRIORITY_LABELS[props.priority] ?? PRIORITY_LABELS[3]!

  return (
    <span
      className={[BASE_CLASS, 'tracking-[0.12em]', priorityMeta.color, props.className]
        .filter(Boolean)
        .join(' ')}
    >
      {priorityMeta.label}
    </span>
  )
}
