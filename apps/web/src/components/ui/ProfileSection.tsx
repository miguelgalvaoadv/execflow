import type { ReactNode } from 'react'
import { surfaces } from '@/components/dashboard/surfaces'

type ProfileSectionProps = {
  title: string
  children: ReactNode
  className?: string
}

export function ProfileSection({ title, children, className }: ProfileSectionProps) {
  return (
    <section
      className={[`rounded-xl ${surfaces.panel} p-5`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <h2 className="mb-4 border-b border-slate-100 pb-3 text-[14px] font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  )
}
