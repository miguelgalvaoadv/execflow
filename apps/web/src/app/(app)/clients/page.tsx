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
import { ClientCard } from '@/components/dashboard/ClientCard'
import { text } from '@/components/dashboard/surfaces'
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSelect,
  LoadingState,
  SearchField,
} from '@/components/ui'
import { CreateClientModal } from '@/components/modals/CreateClientModal'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'active', label: 'Ativo' },
  { value: 'inactive', label: 'Inativo' },
  { value: 'merged', label: 'Fundido' },
  { value: 'archived', label: 'Arquivado' },
] as const

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  merged: 'Fundido',
  archived: 'Arquivado',
}

/** Badge class semântica por status de cliente. */
function clientStatusBadgeClass(status: string): string {
  if (status === 'active') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (status === 'inactive') return 'text-amber-700 bg-amber-50 border-amber-200'
  if (status === 'merged') return 'text-blue-700 bg-blue-50 border-blue-200'
  if (status === 'archived') return 'text-slate-500 bg-slate-100 border-slate-200'
  return 'text-slate-600 bg-slate-100 border-slate-200'
}

function clientDisplayName(item: { displayName: string | null; fullName: string }): string {
  return item.displayName ?? item.fullName
}

export default function ClientsPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const [showCreateModal, setShowCreateModal] = useState(false)
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
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <span className="text-[15px] leading-none">+</span> Novo cliente
          </Button>
        }
      />

      <CreateClientModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      <div className="space-y-4">
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
                ? 'Nenhum cliente corresponde aos filtros atuais.'
                : 'Os clientes da organização aparecerão aqui.'
            }
          />
        ) : (
          <div className="space-y-3">
            <p className={`text-[12px] ${text.muted}`}>
              {items.length} {items.length === 1 ? 'cliente' : 'clientes'}
              {hasActiveFilters ? ' encontrado(s)' : ''}
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <ClientCard
                  key={item.id}
                  id={item.id}
                  name={clientDisplayName(item)}
                  internalRef={item.internalRef}
                  statusLabel={STATUS_LABELS[item.status] ?? item.status}
                  statusBadgeClass={clientStatusBadgeClass(item.status)}
                  updatedAt={item.updatedAt}
                />
              ))}
            </div>

            {hasNextPage ? (
              <div className="pt-1">
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
