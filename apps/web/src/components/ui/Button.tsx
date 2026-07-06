import type { ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'ghost'
type ButtonSize = 'sm' | 'md'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 text-white border border-blue-600 shadow-sm hover:bg-blue-700 disabled:opacity-40',
  secondary:
    'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50',
  success:
    'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50',
  ghost:
    'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'rounded-lg px-3 py-1.5 text-[13px] font-medium',
  md: 'rounded-lg px-4 py-2 text-[13px] font-medium',
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
        'inline-flex items-center justify-center gap-1.5 transition-colors duration-150 disabled:cursor-not-allowed active:translate-y-px',
        isPrimary
          ? 'rounded-lg px-4 py-2 text-[13px] font-medium'
          : isGhost
            ? 'rounded-lg px-3 py-1.5 text-[13px] font-medium'
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
