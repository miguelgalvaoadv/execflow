'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NavIcon } from './NavIcon'
import type { NavItem } from './nav-items'
import { borders, text } from './surfaces'

type SidebarNavItemProps = {
  item: NavItem
  onNavigate?: () => void
}

export function SidebarNavItem({ item, onNavigate }: SidebarNavItemProps) {
  const pathname = usePathname()
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`)

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={[
        'group relative flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors',
        active
          ? `bg-slate-100/60 ${text.primary} shadow-sm border border-slate-200/60`
          : `${text.muted} hover:bg-slate-50 hover:text-slate-800 border border-transparent`,
      ].join(' ')}
    >
      {active ? (
        <span
          className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-indigo-500"
          aria-hidden
        />
      ) : null}
      <span
        className={[
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border transition-colors',
          active
            ? `border-slate-200 bg-white text-indigo-600 shadow-sm`
            : `border-transparent bg-transparent text-slate-500 group-hover:border-slate-200 group-hover:bg-white group-hover:text-slate-600 group-hover:shadow-sm`,
        ].join(' ')}
      >
        <NavIcon name={item.icon} className="h-4 w-4" />
      </span>
      <span className="truncate text-[13px] font-medium tracking-[-0.01em]">
        {item.label}
      </span>
    </Link>
  )
}
