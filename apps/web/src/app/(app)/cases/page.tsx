'use client'

/**
 * Execution cases list — operational surface for browsing org cases.
 *
 * Data: GET /api/v1/cases (cursor pagination, filters, search).
 * Entry to Case Workspace: /cases/[caseId]
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useCases } from '@/lib/hooks/use-cases'
import { DashboardPageHeader } from '@/components/dashboard'
import { text } from '@/components/dashboard/surfaces'
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSelect,
  FilterTextField,
  ListCard,
  LoadingState,
  SearchField,
  StatusBadge,
  KanbanBoard,
} from '@/components/ui'
import type { KanbanColumn } from '@/components/ui/KanbanBoard'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'intake', label: 'Triagem' },
  { value: 'active', label: 'Activo' },
  { value: 'suspended', label: 'Suspenso' },
  { value: 'closed', label: 'Encerrado' },
  { value: 'archived', label: 'Arquivado' },
] as const

const STATUS_LABELS: Record<string, string> = {
  intake: 'Triagem',
  active: 'Activo',
  suspended: 'Suspenso',
  closed: 'Encerrado',
  archived: 'Arquivado',
}

/** Accent visual por status — helper local, não altera ListCard. */
function caseStatusAccentClass(status: string): string {
  if (status === 'active') return 'border-emerald-900/30 bg-emerald-950/10'
  if (status === 'intake') return 'border-blue-900/30 bg-blue-950/10'
  if (status === 'suspended') return 'border-amber-900/30 bg-amber-950/10'
  return ''
}

/** Badge class semântica por status de caso. */
function caseStatusBadgeClass(status: string): string {
  if (status === 'active') return 'text-emerald-400 bg-emerald-950/40 border-emerald-900/40'
  if (status === 'intake') return 'text-blue-400 bg-blue-950/40 border-blue-900/40'
  if (status === 'suspended') return 'text-amber-400 bg-amber-950/40 border-amber-900/40'
  if (status === 'closed') return 'text-zinc-400 bg-white/[0.03] border-white/[0.06]'
  if (status === 'archived') return 'text-zinc-500 bg-white/[0.02] border-white/[0.04]'
  return 'text-zinc-400 bg-white/[0.03] border-white/[0.06]'
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function clientDisplayName(item: {
  clientSummary: { displayName: string | null; fullName: string }
}): string {
  return item.clientSummary.displayName ?? item.clientSummary.fullName
}

export default function CasesPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [jurisdictionFilter, setJurisdictionFilter] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')

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
      ...(jurisdictionFilter.trim() !== ''
        ? { courtJurisdiction: jurisdictionFilter.trim() }
        : {}),
    }),
    [debouncedQ, statusFilter, jurisdictionFilter]
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
  } = useCases({
    organizationId: session?.organization.id ?? '',
    filters,
    enabled: session !== null && session !== undefined,
  })

  const items = data?.pages.flatMap((page) => page.data) ?? []
  const hasActiveFilters =
    debouncedQ !== '' || statusFilter !== '' || jurisdictionFilter.trim() !== ''

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Execuções"
        description="Casos em execução penal da sua organização."
      />

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setViewMode('list')}
          className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
            viewMode === 'list'
              ? 'bg-slate-100 border-slate-300 text-slate-800'
              : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          Lista
        </button>
        <button
          onClick={() => setViewMode('kanban')}
          className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
            viewMode === 'kanban'
              ? 'bg-slate-100 border-slate-300 text-slate-800'
              : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          Kanban
        </button>
      </div>

      <div className="mt-6 space-y-4">
        <FilterBar>
          <SearchField
            id="case-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Nome, ref. ou processo…"
          />
          <FilterSelect
            id="case-status"
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
          />
          <FilterTextField
            id="case-jurisdiction"
            label="Comarca / UF"
            value={jurisdictionFilter}
            onChange={setJurisdictionFilter}
            placeholder="Ex.: São Paulo/SP"
            width="text-sm"
          />
        </FilterBar>

        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : isLoading ? (
          <LoadingState label="Carregando execuções…" />
        ) : isError ? (
          <ErrorState
            message={error?.message ?? 'Erro ao carregar execuções.'}
            onRetry={() => { void refetch() }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'Nenhum caso encontrado' : 'Nenhuma execução'}
            description={
              hasActiveFilters
                ? 'Nenhum caso corresponde aos filtros actuais.'
                : 'Os casos de execução penal da organização aparecerão aqui.'
            }
          />
        ) : (
          <div className="space-y-2">
            <p className={`text-[12px] ${text.faint} mb-3`}>
              {items.length} {items.length === 1 ? 'execução' : 'execuções'}
              {hasActiveFilters ? ' encontrada(s)' : ''}
            </p>

            {viewMode === 'list' ? (
              <>
                <ul className="space-y-2" aria-label="Execuções">
                  {items.map((item) => (
                    <li key={item.id}>
                      <ListCard
                        href={`/cases/${item.id}`}
                        accentClassName={caseStatusAccentClass(item.status)}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                          <p className={`text-[13px] font-medium ${text.secondary}`}>
                            {clientDisplayName(item)}
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={[
                                'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]',
                                caseStatusBadgeClass(item.status),
                              ].join(' ')}
                            >
                              {STATUS_LABELS[item.status] ?? item.status}
                            </span>
                            <span className={`text-[11px] ${text.faint} tabular-nums`}>
                              {formatDateTime(item.updatedAt)}
                            </span>
                          </div>
                        </div>
                        <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] ${text.faint}`}>
                          <span>Ref. {item.internalRef}</span>
                          <span>
                            {item.executionProcessNumber !== null
                              ? item.executionProcessNumber
                              : 'Processo pendente'}
                          </span>
                          {item.courtName !== null && <span>{item.courtName}</span>}
                        </div>
                      </ListCard>
                    </li>
                  ))}
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
              </>
            ) : (
              <KanbanBoard
                columns={[
                  {
                    id: 'intake',
                    title: 'Triagem',
                    items: items.filter((i) => i.status === 'intake'),
                    renderItem: (item) => (
                      <ListCard key={item.id} href={`/cases/${item.id}`} accentClassName={caseStatusAccentClass(item.status)}>
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{clientDisplayName(item)}</p>
                        <p className={`mt-1 text-[11px] ${text.faint}`}>Ref. {item.internalRef}</p>
                      </ListCard>
                    ),
                  },
                  {
                    id: 'active',
                    title: 'Ativo',
                    items: items.filter((i) => i.status === 'active'),
                    renderItem: (item) => (
                      <ListCard key={item.id} href={`/cases/${item.id}`} accentClassName={caseStatusAccentClass(item.status)}>
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{clientDisplayName(item)}</p>
                        <p className={`mt-1 text-[11px] ${text.faint}`}>Ref. {item.internalRef}</p>
                      </ListCard>
                    ),
                  },
                  {
                    id: 'suspended',
                    title: 'Suspenso',
                    items: items.filter((i) => i.status === 'suspended'),
                    renderItem: (item) => (
                      <ListCard key={item.id} href={`/cases/${item.id}`} accentClassName={caseStatusAccentClass(item.status)}>
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{clientDisplayName(item)}</p>
                        <p className={`mt-1 text-[11px] ${text.faint}`}>Ref. {item.internalRef}</p>
                      </ListCard>
                    ),
                  },
                  {
                    id: 'closed',
                    title: 'Encerrado',
                    items: items.filter((i) => ['closed', 'archived'].includes(i.status)),
                    renderItem: (item) => (
                      <ListCard key={item.id} href={`/cases/${item.id}`} accentClassName={caseStatusAccentClass(item.status)}>
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{clientDisplayName(item)}</p>
                        <p className={`mt-1 text-[11px] ${text.faint}`}>Ref. {item.internalRef}</p>
                      </ListCard>
                    ),
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
