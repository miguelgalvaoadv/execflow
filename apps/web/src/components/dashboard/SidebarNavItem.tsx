'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NavIcon } from './NavIcon'
import type { NavItem } from './nav-items'

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
        'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors duration-150',
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      ].join(' ')}
    >
      <span
        className={[
          'flex h-5 w-5 shrink-0 items-center justify-center transition-colors duration-150',
          active ? 'text-blue-600' : 'text-slate-700 group-hover:text-slate-600',
        ].join(' ')}
      >
        <NavIcon name={item.icon} className="h-[18px] w-[18px]" />
      </span>
      <span className="truncate tracking-[-0.01em]">{item.label}</span>
    </Link>
  )
}
