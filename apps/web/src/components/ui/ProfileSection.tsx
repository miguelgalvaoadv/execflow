import type { ReactNode } from 'react'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'

type ProfileSectionProps = {
  title: string
  children: ReactNode
  className?: string
}

export function ProfileSection({ title, children, className }: ProfileSectionProps) {
  return (
    <section
      className={[
        `rounded-xl border ${borders.subtle} ${surfaces.panel} p-4`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h2
        className={`pb-3 mb-3 border-b border-white/[0.04] text-[11px] font-semibold uppercase tracking-[0.12em] ${text.muted}`}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}
