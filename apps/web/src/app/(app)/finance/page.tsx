'use client'

/**
 * Financeiro — hub geral: selecione um cliente (todos os cadastrados
 * aparecem) e gerencie o ledger financeiro manual dele.
 *
 * Mesmo componente/endpoint da aba "Financeiro" do cadastro do cliente —
 * este hub só adiciona o seletor de cliente por cima (padrão já usado em
 * Oportunidades/Prazos/Tarefas: hub geral + aba por entidade, mesmo dado).
 *
 * Route: /finance
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useClients } from '@/lib/hooks/use-clients'
import { DashboardPageHeader } from '@/components/dashboard'
import { FinanceTab } from '@/components/finance/FinanceTab'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import { EmptyState, ErrorState, LoadingState, SearchField } from '@/components/ui'

function clientDisplayName(item: { displayName: string | null; fullName: string }): string {
  return item.displayName ?? item.fullName
}

export default function FinancePage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''

  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const filters = useMemo(() => (debouncedQ !== '' ? { q: debouncedQ } : {}), [debouncedQ])

  const clientsQuery = useClients({
    organizationId: orgId,
    filters,
    enabled: session !== null && session !== undefined && selectedClient === null,
  })

  const clients = clientsQuery.data?.pages.flatMap((page) => page.data) ?? []

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Sistema"
        title="Financeiro"
        description={
          selectedClient !== null
            ? `Ledger financeiro de ${selectedClient.name}.`
            : 'Selecione um cliente para ver ou registrar honorários, pagamentos e despesas.'
        }
      />

      {selectedClient !== null ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setSelectedClient(null)}
            className={`mb-5 inline-flex items-center gap-1.5 text-[12px] font-medium ${text.muted} hover:text-slate-700 transition-colors`}
          >
            ← Trocar cliente
          </button>
          <FinanceTab organizationId={orgId} clientId={selectedClient.id} />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <SearchField
            id="finance-client-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Buscar cliente por nome ou ref. interna…"
          />

          {sessionLoading ? (
            <LoadingState label="Carregando sessão…" />
          ) : session === null ? (
            <ErrorState message="Sessão não encontrada. Faça login novamente." />
          ) : clientsQuery.isLoading ? (
            <LoadingState label="Carregando clientes…" />
          ) : clientsQuery.isError ? (
            <ErrorState
              message={clientsQuery.error?.message ?? 'Erro ao carregar clientes.'}
              onRetry={() => { void clientsQuery.refetch() }}
            />
          ) : clients.length === 0 ? (
            <EmptyState
              title="Nenhum cliente encontrado"
              description="Cadastre um cliente em Clientes para começar a controlar o financeiro."
            />
          ) : (
            <ul className={`divide-y rounded-xl border ${borders.subtle} ${surfaces.panelInset} overflow-hidden`}>
              {clients.map((client) => (
                <li key={client.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedClient({ id: client.id, name: clientDisplayName(client) })}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <div>
                      <p className={`text-[13px] font-medium ${text.secondary}`}>{clientDisplayName(client)}</p>
                      {client.internalRef !== null && (
                        <p className={`text-[11px] ${text.faint}`}>Ref. {client.internalRef}</p>
                      )}
                    </div>
                    <span className={`text-[12px] ${text.faint}`}>Abrir financeiro →</span>
                  </button>
                </li>
              ))}

              {clientsQuery.hasNextPage && (
                <li className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => { void clientsQuery.fetchNextPage() }}
                    disabled={clientsQuery.isFetchingNextPage}
                    className={`text-[12px] font-medium ${text.muted} hover:underline`}
                  >
                    {clientsQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
