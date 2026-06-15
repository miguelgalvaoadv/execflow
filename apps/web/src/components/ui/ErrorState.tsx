/**
 * Error state — surfaces API or render failures honestly.
 */

import { borders, text, surfaces } from '@/components/dashboard/surfaces'

export type ErrorStateVariant = 'default' | 'inline'

type ErrorStateProps = {
  message: string
  onRetry?: () => void
  title?: string
  variant?: ErrorStateVariant
}

export function ErrorState({
  message,
  onRetry,
  title = 'Não foi possível carregar',
  variant = 'default',
}: ErrorStateProps) {
  return (
    <div
      className={`rounded-xl border ${borders.default} ${surfaces.panelInset} px-5 py-6`}
      role="alert"
    >
      {variant === 'default' && (
        <p className="text-sm font-medium text-red-400">{title}</p>
      )}
      <p
        className={[
          'text-[13px] font-mono',
          text.muted,
          variant === 'default' ? 'mt-1' : '',
        ].join(' ')}
      >
        {message}
      </p>
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className={`mt-3 text-[13px] ${text.secondary} underline underline-offset-2 hover:${text.primary}`}
        >
          Tentar novamente
        </button>
      )}
    </div>
  )
}

/** @deprecated Use `<ErrorState />` from `@/components/ui` */
export const OperationalErrorState = ErrorState
