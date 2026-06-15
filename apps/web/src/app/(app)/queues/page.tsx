'use client'

/**
 * Queue operational surface — the primary work interface.
 *
 * Displays queue projections from GET /api/v1/queue-projections.
 * Queue projections are READ-ONLY: they are written by workers via
 * the transactional outbox → relay → pg-boss pipeline.
 *
 * No legal logic. No queue derivation. Frontend consumes projections only.
 *
 * Architecture ref: office-operating-system.md §2 (queue catalog),
 *                   ux-flow-architecture.md §4 (queue-first interaction model).
 */

import { useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useQueueProjections } from '@/lib/hooks/use-queue-projections'
import { DashboardPageHeader } from '@/components/dashboard'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import { QUEUE_TYPE_LABELS } from '@/lib/operational/queue-display'
import {
  EmptyState,
  ErrorState,
  ListCard,
  LoadingState,
  PriorityBadge,
} from '@/components/ui'

const QUEUE_FILTERS = [
  { id: undefined, label: 'Todas' },
  { id: 'urgent_liberty_risks', label: 'Liberdade' },
  { id: 'opportunity_review', label: 'Oportunidades' },
  { id: 'progression_opportunities', label: 'Progresso' },
  { id: 'overdue_deadlines', label: 'Prazos' },
] as const

/** Accent visual por prioridade — helper local, não altera ListCard. */
function queuePriorityAccentClass(priority: number): string {
  if (priority === 0) return 'border-red-900/50 bg-red-950/20'
  if (priority === 1) return 'border-orange-900/30 bg-orange-950/10'
  if (priority === 2) return 'border-amber-900/30 bg-amber-950/10'
  return ''
}

export default function QueuesPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const [activeFilter, setActiveFilter] = useState<string | undefined>(undefined)

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQueueProjections({
    organizationId: session?.organization.id ?? '',
    queueType: activeFilter,
  })

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Fila de trabalho"
        description="Itens que requerem ação. Ordenados por prioridade e prazo."
      />

      <div className="mt-6">
        {/* Queue type filter tabs */}
        <div
          className={`flex gap-1 rounded-xl border ${borders.subtle} ${surfaces.panelInset} p-1 mb-5 overflow-x-auto`}
          role="tablist"
          aria-label="Filtrar por tipo de fila"
        >
          {QUEUE_FILTERS.map((f) => (
            <button
              key={f.id ?? 'all'}
              role="tab"
              aria-selected={activeFilter === f.id}
              onClick={() => setActiveFilter(f.id)}
              type="button"
              className={[
                'shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                activeFilter === f.id
                  ? `bg-white/[0.07] ${text.primary} shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]`
                  : `${text.faint} hover:${text.muted}`,
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {sessionLoading || (session === null && !isError) ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : isLoading ? (
          <LoadingState label="Carregando fila…" />
        ) : isError ? (
          <ErrorState
            message={error?.message ?? 'Erro ao carregar fila.'}
            onRetry={() => { void refetch() }}
          />
        ) : data === undefined || data.data.length === 0 ? (
          <EmptyState
            title="Fila limpa"
            description={
              activeFilter !== undefined
                ? `Nenhum item na fila "${QUEUE_TYPE_LABELS[activeFilter] ?? activeFilter}".`
                : 'Nenhum item pendente no momento.'
            }
          />
        ) : (
          <div className="space-y-2">
            <p className={`text-[12px] ${text.faint} mb-3`}>
              {data.data.length} {data.data.length === 1 ? 'item' : 'itens'}
              {activeFilter !== undefined
                ? ` em "${QUEUE_TYPE_LABELS[activeFilter] ?? activeFilter}"`
                : ' na fila'}
            </p>
            <ul className="space-y-2" aria-label="Itens da fila">
              {data.data.map((item) => {
                const card = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <PriorityBadge priority={item.priority} />
                        <span className={`text-[11px] ${text.faint}`}>
                          {QUEUE_TYPE_LABELS[item.queueType] ?? item.queueType}
                        </span>
                      </div>
                      <p className={`text-[13px] font-medium ${text.secondary} truncate`}>
                        {item.displayTitle}
                      </p>
                      {item.slaDeadlineAt !== null && (
                        <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                          Prazo:{' '}
                          {new Intl.DateTimeFormat('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          }).format(new Date(item.slaDeadlineAt))}
                        </p>
                      )}
                    </div>
                    <div className={`shrink-0 text-[11px] ${text.faint} tabular-nums mt-0.5`}>
                      {new Intl.DateTimeFormat('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                      }).format(new Date(item.createdAt))}
                    </div>
                  </>
                )
                return (
                  <li key={item.id}>
                    <ListCard
                      variant="row"
                      href={
                        item.executionCaseId !== null
                          ? `/cases/${item.executionCaseId}`
                          : undefined
                      }
                      accentClassName={queuePriorityAccentClass(item.priority)}
                    >
                      {card}
                    </ListCard>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
