'use client'

/**
 * Execution cases list — operational surface for browsing org cases.
 *
 * Data: GET /api/v1/cases (cursor pagination, filters, search).
 * Entry to Case Workspace: /cases/[caseId]
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/hooks/use-session'
import { useCases } from '@/lib/hooks/use-cases'
import { DashboardPageHeader } from '@/components/dashboard'
import { CaseCard } from '@/components/dashboard/CaseCard'
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
import { CreateCaseModal } from '@/components/modals/CreateCaseModal'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'intake', label: 'Triagem' },
  { value: 'active', label: 'Ativo' },
  { value: 'suspended', label: 'Suspenso' },
  { value: 'closed', label: 'Encerrado' },
  { value: 'archived', label: 'Arquivado' },
] as const

const STATUS_LABELS: Record<string, string> = {
  intake: 'Triagem',
  active: 'Ativo',
  suspended: 'Suspenso',
  closed: 'Encerrado',
  archived: 'Arquivado',
}

/** Accent visual por status — helper local, não altera ListCard. */
function caseStatusAccentClass(status: string): string {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50'
  if (status === 'intake') return 'border-blue-200 bg-blue-50'
  if (status === 'suspended') return 'border-amber-200 bg-amber-50'
  return ''
}

/** Badge class semântica por status de caso. */
function caseStatusBadgeClass(status: string): string {
  if (status === 'active') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (status === 'intake') return 'text-blue-700 bg-blue-50 border-blue-200'
  if (status === 'suspended') return 'text-amber-700 bg-amber-50 border-amber-200'
  if (status === 'closed') return 'text-slate-600 bg-slate-50 border-slate-100'
  if (status === 'archived') return 'text-slate-500 bg-slate-50 border-slate-100'
  return 'text-slate-600 bg-slate-50 border-slate-100'
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

const MONITORING_OPTIONS = [
  { value: '', label: 'Todo monitoramento' },
  { value: 'monitored', label: 'Monitorado' },
  { value: 'manual_review', label: 'Conferência manual' },
  { value: 'sealed', label: 'Segredo de justiça' },
] as const

export default function CasesPage() {
  const router = useRouter()
  const { data: session, isLoading: sessionLoading } = useSession()
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [jurisdictionFilter, setJurisdictionFilter] = useState('')
  const [monitoringFilter, setMonitoringFilter] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')
  const [showCreateModal, setShowCreateModal] = useState(false)

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
  const visibleItems =
    monitoringFilter !== ''
      ? items.filter((i) => i.monitoringStatus === monitoringFilter)
      : items
  const hasActiveFilters =
    debouncedQ !== '' || statusFilter !== '' || jurisdictionFilter.trim() !== ''

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Execuções"
        description="Casos em execução penal da sua organização."
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <span className="text-[15px] leading-none">+</span> Novo caso
          </Button>
        }
      />

      <CreateCaseModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
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
          <FilterSelect
            id="case-monitoring"
            label="Monitoramento"
            value={monitoringFilter}
            onChange={setMonitoringFilter}
            options={MONITORING_OPTIONS}
            width="select-md"
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
                ? 'Nenhum caso corresponde aos filtros atuais.'
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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleItems.map((item) => (
                    <CaseCard
                      key={item.id}
                      id={item.id}
                      clientName={clientDisplayName(item)}
                      internalRef={item.internalRef}
                      processNumber={item.executionProcessNumber}
                      courtName={item.courtName}
                      jurisdiction={item.courtJurisdiction}
                      statusLabel={STATUS_LABELS[item.status] ?? item.status}
                      statusBadgeClass={caseStatusBadgeClass(item.status)}
                      updatedAt={item.updatedAt}
                      monitoringStatus={item.monitoringStatus}
                      documentFreshnessStatus={item.documentFreshnessStatus}
                    />
                  ))}
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
