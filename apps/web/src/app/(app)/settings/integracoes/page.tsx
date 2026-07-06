'use client'

/**
 * Integrações — estado honesto de cada fonte externa (spec §22).
 * O status vem do backend (credencial real no ambiente + última execução).
 * Nada aqui é hardcoded como "conectado".
 */

import { useQuery } from '@tanstack/react-query'
import { PlugZap, FileUp } from 'lucide-react'
import { apiGet, ApiError } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'
import { DashboardPageHeader } from '@/components/dashboard'
import { text } from '@/components/dashboard/surfaces'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui'

type Connector = {
  id: string
  kind: string
  name: string
  category: string
  status: string
  hasCredential: boolean
  manualImportAvailable: boolean
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  notes: string | null
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  connected: { label: 'Conectado', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  pending_credential: { label: 'Pendente de credencial', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  auth_error: { label: 'Erro de autenticação', cls: 'text-red-700 bg-red-50 border-red-200' },
  disabled: { label: 'Pausado', cls: 'text-slate-600 bg-slate-100 border-slate-300' },
  never_synced: { label: 'Nunca sincronizado', cls: 'text-blue-700 bg-blue-50 border-blue-200' },
}

const CATEGORY_LABELS: Record<string, string> = {
  intimacoes: 'Intimações e publicações',
  movimentacoes: 'Movimentações e metadados',
  autos: 'Autos',
  agenda: 'Agenda',
  notificacao: 'Notificações',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'nunca'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export default function IntegracoesPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''

  const query = useQuery<{ data: Connector[] }, ApiError>({
    queryKey: ['integrations', orgId],
    queryFn: ({ signal }) => apiGet('/api/v1/integrations', { organizationId: orgId, signal }),
    staleTime: 30 * 1000,
    enabled: orgId !== '' && session != null,
  })

  const connectors = query.data?.data ?? []
  const byCategory = connectors.reduce<Record<string, Connector[]>>((acc, conn) => {
    ;(acc[conn.category] ??= []).push(conn)
    return acc
  }, {})

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Sistema"
        title="Integrações"
        description="Estado real de cada fonte — credencial verificada no ambiente, nunca fingida."
      />

      <div className="mt-6 space-y-6">
        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : query.isLoading ? (
          <LoadingState label="Carregando integrações…" />
        ) : query.isError ? (
          <ErrorState
            message={query.error?.message ?? 'Erro ao carregar integrações.'}
            onRetry={() => { void query.refetch() }}
          />
        ) : connectors.length === 0 ? (
          <EmptyState title="Nenhum conector" description="Os conectores padrão serão criados automaticamente." />
        ) : (
          Object.entries(byCategory).map(([category, items]) => (
            <div key={category}>
              <p className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] ${text.faint}`}>
                {CATEGORY_LABELS[category] ?? category}
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {items.map((conn) => {
                  const st = STATUS_CONFIG[conn.status] ?? STATUS_CONFIG['never_synced']!
                  return (
                    <div key={conn.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <PlugZap className="h-4 w-4 shrink-0 text-slate-400" />
                          <p className={`truncate text-[13px] font-semibold ${text.primary}`}>{conn.name}</p>
                        </div>
                        <span className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                          {st.label}
                        </span>
                      </div>
                      <p className={`mt-2 text-[11px] ${text.faint}`}>
                        Última execução: {formatDateTime(conn.lastRunAt)} · Último sucesso:{' '}
                        {formatDateTime(conn.lastSuccessAt)}
                      </p>
                      {conn.lastError !== null && (
                        <p className="mt-1 truncate text-[11px] text-red-600" title={conn.lastError}>
                          Erro: {conn.lastError}
                        </p>
                      )}
                      {conn.notes !== null && (
                        <p className={`mt-1.5 text-[12px] ${text.muted}`}>{conn.notes}</p>
                      )}
                      {conn.manualImportAvailable && (
                        <p className="mt-2 inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
                          <FileUp className="h-3 w-3" /> Importação manual disponível (Inventário → CSV)
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
