import Link from 'next/link'
import { borders, surfaces, text } from './surfaces'

type SummaryMetricCardProps = {
  title: string
  count: number | null
  countLimit: number
  href: string
  loading?: boolean
  description?: string
}

export function formatApproxCount(count: number, limit: number): string {
  return count >= limit ? `${limit}+` : String(count)
}

export function SummaryMetricCard({
  title,
  count,
  countLimit,
  href,
  loading = false,
  description,
}: SummaryMetricCardProps) {
  const display =
    loading || count === null ? '—' : formatApproxCount(count, countLimit)

  return (
    <Link
      href={href}
      className={[
        'group block rounded-xl border px-4 py-4 transition-colors',
        borders.default,
        surfaces.panel,
        `hover:${surfaces.panelRaised}`,
      ].join(' ')}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${text.muted}`}
      >
        {title}
      </p>
      <p
        className={`mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] ${text.primary}`}
      >
        {display}
      </p>
      {description !== undefined && (
        <p className={`mt-1.5 text-[11px] ${text.faint}`}>{description}</p>
      )}
    </Link>
  )
}
