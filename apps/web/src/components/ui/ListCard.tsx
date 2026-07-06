import Link from 'next/link'
import type { ReactNode } from 'react'
import { surfaces } from '@/components/dashboard/surfaces'

export type ListCardVariant = 'link' | 'row' | 'static'

type ListCardProps = {
  variant?: ListCardVariant
  href?: string
  accentClassName?: string
  className?: string
  children: ReactNode
}

const VARIANT_CLASS: Record<ListCardVariant, string> = {
  link: 'block transition-colors duration-150 hover:bg-slate-50 hover:border-slate-300',
  row: 'flex items-start gap-4',
  static: '',
}

export function ListCard({
  variant = 'link',
  href,
  accentClassName,
  className,
  children,
}: ListCardProps) {
  const classes = [
    'rounded-xl',
    surfaces.panel,
    'px-4 py-3.5',
    VARIANT_CLASS[variant],
    href !== undefined && variant === 'row'
      ? 'transition-colors duration-150 hover:bg-slate-50 hover:border-slate-300'
      : '',
    accentClassName,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (href !== undefined) {
    return (
      <Link href={href} className={variant === 'row' ? `${classes} block` : classes}>
        {children}
      </Link>
    )
  }

  return <div className={classes}>{children}</div>
}
