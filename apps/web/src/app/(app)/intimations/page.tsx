'use client'

/**
 * Intimações — comunicações oficiais recebidas (AASP/DJE/manual).
 *
 * Fonte separada de movimentações e autos (regra central do painel).
 * Órfãs (processo sem caso) aparecem aqui para triagem: vincular a um caso
 * ou marcar como irrelevante. Nada é descartado silenciosamente.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert, BellRing } from 'lucide-react'
import { apiGet, apiPost, ApiError } from '@/lib/api-client'
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
  LoadingState,
  SearchField,
} from '@/components/ui'

type CourtCommunication = {
  id: string
  executionCaseId: string | null
  inventoryItemId: string | null
  processNumber: string | null
  kind: string
  source: string
  content: string | null
  availableAt: string | null
  publishedAt: string | null
  acknowledgedAt: string | null
  possibleDeadline: boolean
  status: 'new' | 'processed' | 'orphan' | 'dismissed'
  createdAt: string
}

type Counters = { total: number; orphan: number; unprocessed: number; withDeadline: number }

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'orphan', label: 'Órfãs (triagem)' },
  { value: 'new', label: 'Novas' },
  { value: 'processed', label: 'Processadas' },
  { value: 'dismissed', label: 'Descartadas' },
] as const

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  new: { label: 'Nova', cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  processed: { label: 'Processada', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  orphan: { label: 'Órfã — triagem', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  dismissed: { label: 'Descartada', cls: 'text-slate-500 bg-slate-50 border-slate-200' },
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export default function IntimationsPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [linkTarget, setLinkTarget] = useState<CourtCommunication | null>(null)
  const [linkCaseId, setLinkCaseId] = useState('')

  const filters = useMemo(
    () => ({
      ...(statusFilter !== '' ? { status: statusFilter } : {}),
      ...(searchInput.trim() !== '' ? { q: searchInput.trim() } : {}),
    }),
    [statusFilter, searchInput]
  )

  const query = useQuery<{ data: CourtCommunication[]; counters: Counters | null }, ApiError>({
    queryKey: ['communications', orgId, filters],
    queryFn: ({ signal }) =>
      apiGet('/api/v1/communications', { organizationId: orgId, signal, params: filters }),
    staleTime: 15 * 1000,
    enabled: orgId !== '' && session != null,
  })

  const casesQuery = useCases({
    organizationId: orgId,
    enabled: session != null && linkTarget !== null,
  })

  const resolve = useMutation<
    unknown,
    ApiError,
    { id: string; body: { action: 'link'; executionCaseId: string } | { action: 'dismiss' } }
  >({
    mutationFn: ({ id, body }) =>
      apiPost(`/api/v1/communications/${id}/resolve`, body, { organizationId: orgId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['communications', orgId] })
      setLinkTarget(null)
      setLinkCaseId('')
    },
  })

  const rows = query.data?.data ?? []
  const counters = query.data?.counters ?? null
  const caseOptions = casesQuery.data?.pages.flatMap((p) => p.data) ?? []

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Intimações"
        description="Comunicações oficiais recebidas — separadas de movimentações e autos."
      />

      {counters !== null && counters.total > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
            <p className="text-[18px] font-semibold text-slate-800">{counters.total}</p>
            <p className="text-[11px] text-slate-500">Recebidas</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
            <p className="text-[18px] font-semibold text-amber-700">{counters.orphan}</p>
            <p className="text-[11px] text-amber-700/80">Órfãs — precisam de triagem</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5">
            <p className="text-[18px] font-semibold text-blue-700">{counters.unprocessed}</p>
            <p className="text-[11px] text-blue-700/80">Novas</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
            <p className="text-[18px] font-semibold text-red-700">{counters.withDeadline}</p>
            <p className="text-[11px] text-red-700/80">Com possível prazo</p>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-4">
        <FilterBar>
          <SearchField
            id="comm-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Processo ou conteúdo…"
          />
          <FilterSelect
            id="comm-status"
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
        ) : query.isLoading ? (
          <LoadingState label="Carregando intimações…" />
        ) : query.isError ? (
          <ErrorState
            message={query.error?.message ?? 'Erro ao carregar intimações.'}
            onRetry={() => { void query.refetch() }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nenhuma intimação"
            description="As intimações recebidas via AASP (e outras fontes configuradas) aparecerão aqui automaticamente."
          />
        ) : (
          <div className="space-y-2">
            {rows.map((comm) => {
              const badge = STATUS_BADGES[comm.status] ?? STATUS_BADGES['new']!
              return (
                <div
                  key={comm.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <BellRing className="h-4 w-4 shrink-0 text-slate-400" />
                        <p className={`text-[13px] font-semibold ${text.primary}`}>
                          {comm.processNumber ?? 'Processo não identificado'}
                        </p>
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {comm.possibleDeadline && comm.status !== 'dismissed' && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                            <TriangleAlert className="h-3 w-3" /> possível prazo
                          </span>
                        )}
                        <span className={`text-[11px] uppercase ${text.faint}`}>{comm.source}</span>
                      </div>
                      <p className={`mt-1.5 text-[13px] ${text.muted}`}>
                        {comm.content ?? '(sem conteúdo)'}
                      </p>
                      <p className={`mt-1 text-[11px] ${text.faint}`}>
                        Disponibilizada: {formatDateTime(comm.availableAt)} · Recebida:{' '}
                        {formatDateTime(comm.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {comm.executionCaseId !== null && (
                        <Link
                          href={`/cases/${comm.executionCaseId}`}
                          className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                        >
                          Abrir caso
                        </Link>
                      )}
                      {(comm.status === 'orphan' || comm.status === 'new') && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setLinkTarget(comm); setLinkCaseId('') }}
                            className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
                          >
                            Vincular a caso
                          </button>
                          <button
                            type="button"
                            onClick={() => resolve.mutate({ id: comm.id, body: { action: 'dismiss' } })}
                            disabled={resolve.isPending}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-100"
                          >
                            Descartar
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Painel inline de vínculo */}
                  {linkTarget?.id === comm.id && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2.5">
                      <select
                        value={linkCaseId}
                        onChange={(e) => setLinkCaseId(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-blue-600"
                      >
                        <option value="">— selecionar caso —</option>
                        {caseOptions.map((cs) => (
                          <option key={cs.id} value={cs.id}>
                            {cs.clientSummary.displayName ?? cs.clientSummary.fullName} — {cs.executionProcessNumber ?? cs.internalRef}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() =>
                          resolve.mutate({
                            id: comm.id,
                            body: { action: 'link', executionCaseId: linkCaseId },
                          })
                        }
                        disabled={linkCaseId === '' || resolve.isPending}
                      >
                        {resolve.isPending ? 'Vinculando…' : 'Confirmar vínculo'}
                      </Button>
                      <Button size="md" onClick={() => setLinkTarget(null)}>
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
