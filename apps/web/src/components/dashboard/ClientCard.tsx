import Link from 'next/link'
import { User, Hash, ChevronRight, Clock } from 'lucide-react'

export type ClientCardProps = {
  id: string
  name: string
  internalRef: string | null
  statusLabel: string
  statusBadgeClass: string
  updatedAt: string
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

export function ClientCard({
  id,
  name,
  internalRef,
  statusLabel,
  statusBadgeClass,
  updatedAt,
}: ClientCardProps) {
  return (
    <Link
      href={`/clients/${id}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${avatarColor(name)}`}
            aria-hidden
          >
            {initials(name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-slate-900 group-hover:text-blue-700">
              {name}
            </p>
            <p className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <User className="h-3 w-3" /> Cliente · execução penal
            </p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
            Ref. interna
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1 truncate text-[12px] font-medium text-slate-800">
            <Hash className="h-3 w-3 text-slate-400" />
            {internalRef ?? '—'}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
            Atualizado
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1 truncate text-[12px] font-medium text-slate-800">
            <Clock className="h-3 w-3 text-slate-400" />
            {formatDate(updatedAt)}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-end border-t border-slate-100 pt-3">
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-blue-600">
          Abrir perfil
          <ChevronRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}
