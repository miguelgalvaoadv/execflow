import type { ButtonHTMLAttributes } from 'react'
import { borders, text } from '@/components/dashboard/surfaces'

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'ghost'
type ButtonSize = 'sm' | 'md'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 border border-indigo-700 shadow-sm',
  secondary: [
    `border ${borders.default} bg-white shadow-sm ${text.secondary}`,
    'hover:bg-slate-50 disabled:opacity-50',
  ].join(' '),
  success: [
    'border border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm',
    'hover:bg-emerald-100 disabled:opacity-50',
  ].join(' '),
  ghost: `${text.faint} hover:text-slate-800`,
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'rounded-lg border px-3 py-1.5 text-[13px] font-medium',
  md: 'rounded-lg border px-4 py-2 text-[13px] font-medium',
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  fullWidth = false,
  className,
  type = 'button',
  disabled,
  ...props
}: ButtonProps) {
  const isPrimary = variant === 'primary'
  const isGhost = variant === 'ghost'

  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        'transition-colors disabled:cursor-not-allowed',
        isPrimary
          ? 'rounded-lg px-4 py-2.5 text-[13px] font-medium'
          : isGhost
            ? 'text-[13px]'
            : SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}
