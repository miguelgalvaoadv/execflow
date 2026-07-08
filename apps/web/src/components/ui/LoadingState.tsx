/**
 * Loading state — explicit fetch indicator; never fake placeholder data.
 */

import { text } from '@/components/dashboard/surfaces'

export type LoadingStateVariant = 'inline' | 'page'

type LoadingStateProps = {
  label?: string
  variant?: LoadingStateVariant
}

function LoadingStateInline({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 py-6"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
        aria-hidden
      />
      <span className={`text-[13px] ${text.muted}`}>{label}</span>
    </div>
  )
}

export function LoadingState({
  label = 'Carregando…',
  variant = 'inline',
}: LoadingStateProps) {
  if (variant === 'page') {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center">
        <LoadingStateInline label={label} />
      </div>
    )
  }

  return <LoadingStateInline label={label} />
}
