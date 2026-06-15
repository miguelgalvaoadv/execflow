'use client'

/**
 * Deadline Central — org-wide operational deadline list.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useDeadlines } from '@/lib/hooks/use-deadlines'
import { DashboardPageHeader } from '@/components/dashboard'
import { text } from '@/components/dashboard/surfaces'
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSelect,
  ListCard,
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
        description="Prazos processuais activos e vencidos da organização."
      />

      <div className="mt-6 space-y-4">
        <FilterBar>
          <SearchField
            id="dl-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Título ou ref. do caso…"
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
                ? 'Nenhum prazo corresponde aos filtros actuais.'
                : 'Os prazos da organização aparecerão aqui.'
            }
          />
        ) : (
          <div className="space-y-2">
            <p className={`text-[12px] ${text.faint} mb-3`}>
              {items.length} {items.length === 1 ? 'prazo' : 'prazos'}
              {hasActiveFilters ? ' encontrado(s)' : ''}
            </p>
            <ul className="space-y-2" aria-label="Prazos">
              {items.map((item) => {
                const accent = deadlineCardAccentClass(item.status, item.priority)
                return (
                  <li key={item.id}>
                    <ListCard
                      href={`/deadlines/${item.id}`}
                      accentClassName={accent}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                        <p className={`text-[13px] font-medium ${text.secondary}`}>
                          {item.title}
                        </p>
                        <span className={`text-[11px] ${text.faint} tabular-nums shrink-0`}>
                          {formatDateTime(item.dueAt)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <StatusBadge variant="deadline" status={item.status} />
                        <PriorityBadge variant="deadline" priority={item.priority} />
                        <span className={`text-[11px] ${text.faint}`}>
                          {deadlineClassLabel(item.deadlineClass)}
                        </span>
                      </div>
                      {item.caseInternalRef !== null && (
                        <p className={`text-[11px] ${text.faint}`}>
                          Caso: {item.caseInternalRef}
                        </p>
                      )}
                    </ListCard>
                  </li>
                )
              })}
            </ul>

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
