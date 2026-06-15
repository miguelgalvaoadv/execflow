import type { ReactNode } from 'react'
import { text } from '@/components/dashboard/surfaces'
import {
  deadlineStatusBadgeClass,
  deadlineStatusLabel,
} from '@/lib/operational/deadline-display'

const BASE_CLASS =
  'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]'

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
        `border-white/[0.08] bg-white/[0.04] ${text.secondary}`,
        props.className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {props.children}
    </span>
  )
}
