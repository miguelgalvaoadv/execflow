'use client'

/**
 * Clients list — operational surface for browsing org clients.
 *
 * Data: GET /api/v1/clients (cursor pagination, filters, search).
 * Entry to client profile: /clients/[clientId]
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useClients } from '@/lib/hooks/use-clients'
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
  SearchField,
  StatusBadge,
} from '@/components/ui'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'active', label: 'Activo' },
  { value: 'inactive', label: 'Inactivo' },
  { value: 'merged', label: 'Fundido' },
  { value: 'archived', label: 'Arquivado' },
] as const

const STATUS_LABELS: Record<string, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  merged: 'Fundido',
  archived: 'Arquivado',
}

/** Accent visual por status de cliente — helper local. */
function clientStatusAccentClass(status: string): string {
  if (status === 'active') return 'border-emerald-900/30 bg-emerald-950/10'
  if (status === 'inactive') return 'border-amber-900/30 bg-amber-950/10'
  return ''
}

/** Badge class semântica por status de cliente. */
function clientStatusBadgeClass(status: string): string {
  if (status === 'active') return 'text-emerald-400 bg-emerald-950/40 border-emerald-900/40'
  if (status === 'inactive') return 'text-amber-400 bg-amber-950/40 border-amber-900/40'
  if (status === 'merged') return 'text-blue-400 bg-blue-950/40 border-blue-900/40'
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

function clientDisplayName(item: { displayName: string | null; fullName: string }): string {
  return item.displayName ?? item.fullName
}

function formatResponsibleLawyer(userId: string | null): string | null {
  if (userId === null) return null
  return `Responsável · ${userId.slice(0, 8)}…`
}

export default function ClientsPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

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
    }),
    [debouncedQ, statusFilter]
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
  } = useClients({
    organizationId: session?.organization.id ?? '',
    filters,
    enabled: session !== null && session !== undefined,
  })

  const items = data?.pages.flatMap((page) => page.data) ?? []
  const hasActiveFilters = debouncedQ !== '' || statusFilter !== ''

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Clientes"
        description="Cadastro de clientes associados a execuções penais."
      />

      <div className="mt-6 space-y-4">
        <FilterBar>
          <SearchField
            id="client-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Nome ou ref. interna…"
          />
          <FilterSelect
            id="client-status"
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
          />
        </FilterBar>

        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : isLoading ? (
          <LoadingState label="Carregando clientes…" />
        ) : isError ? (
          <ErrorState
            message={error?.message ?? 'Erro ao carregar clientes.'}
            onRetry={() => { void refetch() }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'Nenhum cliente encontrado' : 'Nenhum cliente'}
            description={
              hasActiveFilters
                ? 'Nenhum cliente corresponde aos filtros actuais.'
                : 'Os clientes da organização aparecerão aqui.'
            }
          />
        ) : (
          <div className="space-y-2">
            <p className={`text-[12px] ${text.faint} mb-3`}>
              {items.length} {items.length === 1 ? 'cliente' : 'clientes'}
              {hasActiveFilters ? ' encontrado(s)' : ''}
            </p>
            <ul className="space-y-2" aria-label="Clientes">
              {items.map((item) => {
                const responsible = formatResponsibleLawyer(item.responsibleLawyerUserId)
                return (
                  <li key={item.id}>
                    <ListCard
                      href={`/clients/${item.id}`}
                      accentClassName={clientStatusAccentClass(item.status)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                        <p className={`text-[13px] font-medium ${text.secondary}`}>
                          {clientDisplayName(item)}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={[
                              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]',
                              clientStatusBadgeClass(item.status),
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
                        {item.internalRef !== null && <span>Ref. {item.internalRef}</span>}
                        {responsible !== null && <span>{responsible}</span>}
                      </div>
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
