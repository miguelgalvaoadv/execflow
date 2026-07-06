/**
 * Empty state — communicates that a list or section has no items.
 */

import type { ReactNode } from 'react'
import { text } from '@/components/dashboard/surfaces'

export type EmptyStateVariant = 'default' | 'tab'

type EmptyStateProps = {
  title: string
  description?: string
  action?: ReactNode
  /** Optional icon override. Falls back to the generic document SVG. */
  icon?: ReactNode
  /** `tab` uses the same visual as `default`; reserved for section-scoped empty states. */
  variant?: EmptyStateVariant
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  variant: _variant = 'default',
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-50"
        aria-hidden
      >
        {icon !== undefined ? (
          icon
        ) : (
          <svg
            className={`h-5 w-5 ${text.faint}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M9 9h6M9 12h4" />
          </svg>
        )}
      </div>
      <p className={`text-[14px] font-medium ${text.secondary}`}>{title}</p>
      {description !== undefined && (
        <p className={`mt-1 max-w-xs text-[13px] ${text.faint}`}>{description}</p>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  )
}
