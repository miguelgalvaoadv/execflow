'use client'

/**
 * Deadline Central — org-wide operational deadline list.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useDeadlines } from '@/lib/hooks/use-deadlines'
import Link from 'next/link'
import { ChevronRight, FileText } from 'lucide-react'
import { DashboardPageHeader } from '@/components/dashboard'
import { text } from '@/components/dashboard/surfaces'
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSelect,
  LoadingState,
  PriorityBadge,
  SearchField,
  StatusBadge,
} from '@/components/ui'
import {
  DEADLINE_CLASS_FILTER_OPTIONS,
  DEADLINE_PRIORITY_FILTER_OPTIONS,
  DEADLINE_STATUS_FILTER_OPTIONS,
  deadlineCardAccentClass,
  deadlineClassLabel,
} from '@/lib/operational/deadline-display'

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export default function DeadlinesPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const filters = useMemo(
    () => ({
      ...(debouncedQ !== '' ? { q: debouncedQ } : {}),
      ...(statusFilter !== '' ? { status: statusFilter } : {}),
      ...(classFilter !== '' ? { deadlineClass: classFilter } : {}),
      ...(priorityFilter !== '' ? { priority: priorityFilter } : {}),
    }),
    [debouncedQ, statusFilter, classFilter, priorityFilter]
  )

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDeadlines({
    organizationId: session?.organization.id ?? '',
    filters,
    enabled: session !== null && session !== undefined,
  })

  const items = data?.pages.flatMap((page) => page.data) ?? []
  const hasActiveFilters =
    debouncedQ !== '' || statusFilter !== '' || classFilter !== '' || priorityFilter !== ''

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Prazos"
        description="Prazos processuais ativos e vencidos da organização — ordenados do mais urgente (vencimento mais próximo) para o menos urgente."
      />

      <div className="mt-6 space-y-4">
        <FilterBar>
          <SearchField
            id="dl-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Título, cliente ou ref. do caso…"
          />
          <FilterSelect
            id="dl-status"
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={DEADLINE_STATUS_FILTER_OPTIONS}
          />
          <FilterSelect
            id="dl-class"
            label="Classe"
            value={classFilter}
            onChange={setClassFilter}
            options={DEADLINE_CLASS_FILTER_OPTIONS}
            width="select-xs"
          />
          <FilterSelect
            id="dl-priority"
            label="Prioridade"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={DEADLINE_PRIORITY_FILTER_OPTIONS}
            width="select-xs"
          />
        </FilterBar>

        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : isLoading ? (
          <LoadingState label="Carregando prazos…" />
        ) : isError ? (
          <ErrorState
            message={error?.message ?? 'Erro ao carregar prazos.'}
            onRetry={() => { void refetch() }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'Nenhum prazo encontrado' : 'Nenhum prazo'}
            description={
              hasActiveFilters
                ? 'Nenhum prazo corresponde aos filtros atuais.'
                : 'Os prazos da organização aparecerão aqui.'
            }
          />
        ) : (
          <div className="space-y-2">
            <p className={`text-[12px] ${text.faint} mb-3`}>
              {items.length} {items.length === 1 ? 'prazo' : 'prazos'}
              {hasActiveFilters ? ' encontrado(s)' : ''}
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const accent = deadlineCardAccentClass(item.status, item.priority)
                return (
                  <Link
                    key={item.id}
                    href={`/deadlines/${item.id}`}
                    className={[
                      'group flex flex-col rounded-xl border bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg',
                      accent || 'border-slate-200',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">
                        {deadlineClassLabel(item.deadlineClass)}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                        {formatDateTime(item.dueAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-[14px] font-semibold leading-snug text-slate-900 group-hover:text-blue-700">
                      {item.title}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <StatusBadge variant="deadline" status={item.status} />
                      <PriorityBadge variant="deadline" priority={item.priority} />
                    </div>
                    <div className="mt-2.5 min-w-0">
                      <p className="truncate text-[13px] font-medium text-slate-700">
                        {item.clientName ?? 'Cliente não identificado'}
                      </p>
                      <span className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-slate-500">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        {item.processNumber ?? <span className="text-amber-700">Processo pendente</span>}
                      </span>
                    </div>
                    <div className="mt-auto flex items-center justify-end gap-2 border-t border-slate-100 pt-3 text-[12px]">
                      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-blue-600">
                        Abrir
                        <ChevronRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>

            {hasNextPage ? (
              <div className="pt-2">
                <Button
                  size="md"
                  onClick={() => { void fetchNextPage() }}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
