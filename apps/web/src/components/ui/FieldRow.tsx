import type { ReactNode } from 'react'
import { text } from '@/components/dashboard/surfaces'

type FieldRowProps = {
  label: string
  value: ReactNode
  debug?: string
  /** Label column width on sm+ breakpoints. Default matches document/deadline profiles. */
  labelWidth?: '40' | '44'
}

export function FieldRow({ label, value, debug, labelWidth = '44' }: FieldRowProps) {
  const labelWidthClass = labelWidth === '40' ? 'sm:w-40' : 'sm:w-44'

  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4 py-2 border-b border-white/[0.04] last:border-0">
      <dt
        className={`shrink-0 text-[11px] font-medium uppercase tracking-[0.08em] ${text.muted} ${labelWidthClass}`}
      >
        {label}
      </dt>
      <dd className={`text-[13px] ${text.secondary} min-w-0${debug !== undefined || labelWidth === '44' ? ' flex-1' : ''}`}>
        {value}
        {debug !== undefined && (
          <span className={`block mt-0.5 text-[10px] font-mono ${text.faint}`} title="Valor técnico">
            {debug}
          </span>
        )}
      </dd>
    </div>
  )
}
