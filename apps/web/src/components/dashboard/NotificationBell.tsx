'use client'

/**
 * Sininho de notificações (pedido do Miguel 13/07/2026) — fica no topo do
 * painel (cabeçalho da sidebar), mostra a contagem do que precisa de atenção
 * hoje (agenda do dia + prazos atrasados) e abre um painel com a lista.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { useNotifications } from '@/lib/hooks/use-notifications'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { items, isLoading } = useNotifications()
  const count = items.length

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        aria-label={count > 0 ? `Notificações (${count})` : 'Notificações'}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3.5 py-2.5">
            <p className="text-[12px] font-semibold text-slate-700">Notificações</p>
            <p className="text-[11px] text-slate-500">Agenda de hoje e prazos atrasados</p>
          </div>

          {isLoading ? (
            <p className="p-4 text-[12px] text-slate-400">Carregando…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-[12px] text-slate-400">Nada por aqui — tudo em dia.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      if (item.href) router.push(item.href)
                    }}
                    className="flex w-full flex-col items-start gap-1 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50"
                  >
                    <div className="flex w-full items-center gap-1.5">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                          item.overdue
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-blue-200 bg-blue-50 text-blue-700'
                        }`}
                      >
                        {item.overdue ? 'Atrasado' : 'Hoje'}
                      </span>
                      {item.clientName && (
                        <span className="truncate text-[11px] text-slate-500">{item.clientName}</span>
                      )}
                    </div>
                    <span className="line-clamp-2 text-[12px] font-medium text-slate-800">{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-slate-100 px-3.5 py-2">
            <Link
              href="/calendar"
              onClick={() => setOpen(false)}
              className="block text-center text-[11px] font-medium text-blue-600 hover:text-blue-700"
            >
              Ver agenda completa
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
