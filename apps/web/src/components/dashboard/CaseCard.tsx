import Link from 'next/link'
import {
  FileText,
  MapPin,
  ChevronRight,
  Landmark,
  CircleCheck,
  TriangleAlert,
  Lock,
  type LucideIcon,
} from 'lucide-react'

export type CaseCardProps = {
  id: string
  clientName: string
  internalRef: string
  processNumber: string | null
  courtName: string | null
  jurisdiction: string | null
  statusLabel: string
  statusBadgeClass: string
  updatedAt: string
  monitoringStatus?: string | null
  documentFreshnessStatus?: string | null
}

type MonitoringConfig = { label: string; className: string; Icon: LucideIcon }

function monitoringConfig(status: string | null | undefined): MonitoringConfig | null {
  if (status === 'monitored')
    return { label: 'Monitorado', className: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CircleCheck }
  if (status === 'manual_review')
    return { label: 'Conferência manual', className: 'text-amber-700 bg-amber-50 border-amber-200', Icon: TriangleAlert }
  if (status === 'sealed')
    return { label: 'Segredo de justiça', className: 'text-slate-700 bg-slate-100 border-slate-300', Icon: Lock }
  return null
}

function freshnessConfig(status: string | null | undefined): MonitoringConfig | null {
  if (status === 'stale')
    return { label: 'Autos desatualizados', className: 'text-red-700 bg-red-50 border-red-200', Icon: TriangleAlert }
  if (status === 'unknown')
    return { label: 'Sem autos carregados', className: 'text-amber-700 bg-amber-50 border-amber-200', Icon: TriangleAlert }
  return null
}

const AVATAR_PALETTE = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]!
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[12px] font-medium text-slate-800" title={value}>
        {value}
      </p>
    </div>
  )
}

export function CaseCard({
  id,
  clientName,
  internalRef,
  processNumber,
  courtName,
  jurisdiction,
  statusLabel,
  statusBadgeClass,
  updatedAt,
  monitoringStatus,
  documentFreshnessStatus,
}: CaseCardProps) {
  const mon = monitoringConfig(monitoringStatus)
  const freshness = freshnessConfig(documentFreshnessStatus)
  return (
    <Link
      href={`/cases/${id}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
    >
      {/* Header — avatar + cliente + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${avatarColor(clientName)}`}
            aria-hidden
          >
            {initials(clientName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-slate-900 group-hover:text-blue-700">
              {clientName}
            </p>
            <p className="text-[11px] text-slate-500">Execução penal</p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass}`}
        >
          {statusLabel}
        </span>
      </div>

      {(mon !== null || freshness !== null) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {mon !== null && (
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${mon.className}`}>
              <mon.Icon className="h-3.5 w-3.5" />
              {mon.label}
            </span>
          )}
          {freshness !== null && (
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${freshness.className}`}>
              <freshness.Icon className="h-3.5 w-3.5" />
              {freshness.label}
            </span>
          )}
        </div>
      )}

      {/* Meta — processo + comarca */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-slate-400" />
          {processNumber ?? <span className="text-amber-700">Processo pendente</span>}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-slate-400" />
          {jurisdiction ?? courtName ?? '—'}
        </span>
      </div>

      {/* Faixa de stats */}
      <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
        <Stat label="Ref. interna" value={internalRef} />
        <Stat label="Vara" value={courtName ?? '—'} />
        <Stat label="Atualizado" value={formatDate(updatedAt)} />
      </div>

      {/* Rodapé */}
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
          <Landmark className="h-3.5 w-3.5 text-slate-400" />
          {jurisdiction ?? 'Comarca não informada'}
        </span>
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-blue-600">
          Abrir caso
          <ChevronRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}
