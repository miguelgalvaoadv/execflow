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
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-6 py-2.5 px-2 sm:px-3 rounded-lg transition-colors hover:bg-slate-50">
      <dt
        className={`shrink-0 text-[12px] font-medium ${text.muted} ${labelWidthClass} sm:pt-0.5`}
      >
        {label}
      </dt>
      <dd className={`text-[14px] ${text.primary} min-w-0${debug !== undefined || labelWidth === '44' ? ' flex-1' : ''}`}>
        {value}
        {debug !== undefined && (
          <span className={`block mt-1 text-[11px] font-mono ${text.faint}`} title="Valor técnico">
            {debug}
          </span>
        )}
      </dd>
    </div>
  )
}
