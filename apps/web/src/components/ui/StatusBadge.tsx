import type { ReactNode } from 'react'
import {
  deadlineStatusBadgeClass,
  deadlineStatusLabel,
} from '@/lib/operational/deadline-display'

const BASE_CLASS =
  'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em]'

type StatusBadgeNeutralProps = {
  variant?: 'neutral'
  children: ReactNode
  className?: string
}

type StatusBadgeDeadlineProps = {
  variant: 'deadline'
  status: string
  className?: string
}

export type StatusBadgeProps = StatusBadgeNeutralProps | StatusBadgeDeadlineProps

export function StatusBadge(props: StatusBadgeProps) {
  if (props.variant === 'deadline') {
    return (
      <span
        className={[BASE_CLASS, deadlineStatusBadgeClass(props.status), props.className]
          .filter(Boolean)
          .join(' ')}
      >
        {deadlineStatusLabel(props.status)}
      </span>
    )
  }

  return (
    <span
      className={[
        BASE_CLASS,
        'border-slate-200 bg-slate-100 text-slate-600',
        props.className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {props.children}
    </span>
  )
}
