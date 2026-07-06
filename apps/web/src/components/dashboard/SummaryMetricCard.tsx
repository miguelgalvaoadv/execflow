import Link from 'next/link'

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
      className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-slate-900">
        {display}
      </p>
      {description !== undefined && (
        <p className="mt-1.5 text-[11px] text-slate-400">{description}</p>
      )}
    </Link>
  )
}
