'use client'

/**
 * Botão "Adicionar à agenda" para um prazo ou oportunidade (pedido do Miguel
 * 13/07/2026). Cria um vínculo em calendar_events via o POST do calendário —
 * idempotente no backend, então clicar de novo não duplica. Usado nas telas
 * por-caso (Prazos/Oportunidades) e nos hubs gerais.
 *
 * Fica dentro de cards que às vezes são <Link>, então o onClick sempre chama
 * preventDefault + stopPropagation pra não navegar ao adicionar.
 */

import { useState } from 'react'
import { CalendarPlus, Check } from 'lucide-react'
import { useCreateCalendarEvent } from '@/lib/hooks/use-calendar'

type Props = {
  organizationId: string
  deadlineId?: string
  opportunityId?: string
  /** Rótulo curto (default "Agenda"). */
  label?: string
  className?: string
}

export function AddToAgendaButton({ organizationId, deadlineId, opportunityId, label = 'Agenda', className }: Props) {
  const create = useCreateCalendarEvent(organizationId)
  const [done, setDone] = useState(false)

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (done || create.isPending) return
    const input = deadlineId ? { sourceDeadlineId: deadlineId } : { sourceOpportunityId: opportunityId }
    create.mutate(input, { onSuccess: () => setDone(true) })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={create.isPending || done}
      className={
        className ??
        [
          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
          done
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
        ].join(' ')
      }
      title={done ? 'Adicionado à agenda' : 'Adicionar à agenda'}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <CalendarPlus className="h-3.5 w-3.5" />}
      {done ? 'Na agenda' : label}
    </button>
  )
}
