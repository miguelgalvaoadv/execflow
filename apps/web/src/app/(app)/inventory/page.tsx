'use client'

/**
 * Inventário por OAB — descoberta e triagem em massa de processos (spec §5).
 *
 * Fluxo: importar metadados (CSV) → classificar prioridade automaticamente →
 * triar (vincular cliente / marcar não é nosso / precisa de autos) →
 * promover a caso operacional apenas os importantes.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { TriangleAlert, Lock, FileUp, RefreshCw, ExternalLink } from 'lucide-react'
import { useSession } from '@/lib/hooks/use-session'
import {
  useInventoryProfiles,
  useInventoryItems,
  useClassifyInventory,
  usePatchInventoryItem,
  type InventoryItem,
  type InventoryItemsFilters,
} from '@/lib/hooks/use-inventory'
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
import { ImportCsvModal } from '@/components/inventory/ImportCsvModal'
import { PromoteItemModal } from '@/components/inventory/PromoteItemModal'
import { CreateProfileModal } from '@/components/inventory/CreateProfileModal'

const PRIORITY_OPTIONS = [
  { value: '', label: 'Todas as prioridades' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Média' },
  { value: 'low', label: 'Baixa' },
] as const

const REVIEW_OPTIONS = [
  { value: '', label: 'Toda revisão' },
  { value: 'unreviewed', label: 'Não conferidos' },
  { value: 'confirmed', label: 'Confirmados' },
  { value: 'not_ours', label: 'Não é nosso' },
  { value: 'archived', label: 'Arquivados' },
] as const

function priorityBadge(priority: string | null): { label: string; cls: string } {
  if (priority === 'high') return { label: 'Alta', cls: 'text-red-700 bg-red-50 border-red-200' }
  if (priority === 'medium') return { label: 'Média', cls: 'text-amber-700 bg-amber-50 border-amber-200' }
  if (priority === 'low') return { label: 'Baixa', cls: 'text-slate-600 bg-slate-50 border-slate-200' }
  return { label: '—', cls: 'text-slate-400 bg-white border-slate-100' }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso)
  )
}

function CounterChip({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'amber' | 'slate' }) {
  const toneCls =
    tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-white text-slate-700'
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 ${toneCls}`}>
      <p className="text-[18px] font-semibold leading-tight">{value}</p>
      <p className="text-[11px] opacity-80">{label}</p>
    </div>
  )
}

export default function InventoryPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''

  const [searchInput, setSearchInput] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [reviewFilter, setReviewFilter] = useState('')
  const [needsAutosOnly, setNeedsAutosOnly] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showCreateProfile, setShowCreateProfile] = useState(false)
  const [promoteItem, setPromoteItem] = useState<InventoryItem | null>(null)

  const filters = useMemo<InventoryItemsFilters>(
    () => ({
      ...(priorityFilter !== '' ? { priority: priorityFilter } : {}),
      ...(reviewFilter !== '' ? { reviewStatus: reviewFilter } : {}),
      ...(needsAutosOnly ? { needsAutos: 'true' } : {}),
      ...(searchInput.trim() !== '' ? { q: searchInput.trim() } : {}),
    }),
    [priorityFilter, reviewFilter, needsAutosOnly, searchInput]
  )

  const profilesQuery = useInventoryProfiles(orgId, session != null)
  const itemsQuery = useInventoryItems(orgId, filters, session != null)
  const classify = useClassifyInventory(orgId)
  const patchItem = usePatchInventoryItem(orgId)

  const profiles = profilesQuery.data?.data ?? []
  const counters = profilesQuery.data?.counters ?? null
  const items = itemsQuery.data?.data ?? []

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Inventário por OAB"
        description="Todos os processos da OAB com metadados — autos completos só dos prioritários."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowCreateProfile(true)}>+ Perfil OAB</Button>
            <Button
              onClick={() => classify.mutate()}
              disabled={classify.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${classify.isPending ? 'animate-spin' : ''}`} />
              {classify.isPending ? 'Classificando…' : 'Reclassificar'}
            </Button>
            <Button variant="primary" onClick={() => setShowImport(true)}>
              <FileUp className="h-3.5 w-3.5" /> Importar CSV
            </Button>
          </div>
        }
      />

      <ImportCsvModal open={showImport} onClose={() => setShowImport(false)} profiles={profiles} />
      <CreateProfileModal open={showCreateProfile} onClose={() => setShowCreateProfile(false)} />
      <PromoteItemModal item={promoteItem} onClose={() => setPromoteItem(null)} />

      {/* Perfis cadastrados */}
      {profiles.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {profiles.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-700"
            >
              <span className="font-medium">{p.lawyerName}</span>
              <span className="text-slate-400">OAB {p.oabNumber}/{p.oabUf}</span>
              {p.lastSyncedAt !== null && (
                <span className="text-slate-400">· sync {formatDate(p.lastSyncedAt)}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Contadores (spec §5) */}
      {counters !== null && counters.total > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <CounterChip label="Encontrados" value={counters.total} />
          <CounterChip label="Ativos" value={counters.active} />
          <CounterChip label="Prioridade alta" value={counters.highPriority} tone="red" />
          <CounterChip label="Precisam de autos" value={counters.needsAutos} tone="amber" />
          <CounterChip label="Em segredo" value={counters.sealed} tone="amber" />
          <CounterChip label="Sem cliente" value={counters.withoutClient} tone="amber" />
          <CounterChip label="Não conferidos" value={counters.unreviewed} />
          <CounterChip label="Promovidos a caso" value={counters.promoted} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        <FilterBar>
          <SearchField
            id="inventory-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Processo, parte, comarca…"
          />
          <FilterSelect
            id="inventory-priority"
            label="Prioridade"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={PRIORITY_OPTIONS}
          />
          <FilterSelect
            id="inventory-review"
            label="Revisão"
            value={reviewFilter}
            onChange={setReviewFilter}
            options={REVIEW_OPTIONS}
          />
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-600">
            <input
              type="checkbox"
              checked={needsAutosOnly}
              onChange={(e) => setNeedsAutosOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Só &quot;precisa de autos&quot;
          </label>
        </FilterBar>

        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : itemsQuery.isLoading ? (
          <LoadingState label="Carregando inventário…" />
        ) : itemsQuery.isError ? (
          <ErrorState
            message={itemsQuery.error?.message ?? 'Erro ao carregar inventário.'}
            onRetry={() => { void itemsQuery.refetch() }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Inventário vazio"
            description='Importe a lista de processos da sua OAB por CSV — só os metadados entram; os autos completos são baixados depois, apenas dos processos prioritários.'
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className={`px-3 py-2.5 font-semibold ${text.secondary}`}>Processo</th>
                  <th className={`px-3 py-2.5 font-semibold ${text.secondary}`}>Vara / Comarca</th>
                  <th className={`px-3 py-2.5 font-semibold ${text.secondary}`}>Última movimentação</th>
                  <th className={`px-3 py-2.5 font-semibold ${text.secondary}`}>Prioridade</th>
                  <th className={`px-3 py-2.5 font-semibold ${text.secondary}`}>Sinais</th>
                  <th className={`px-3 py-2.5 font-semibold ${text.secondary}`}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const badge = priorityBadge(item.priority)
                  return (
                    <tr key={item.id} className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5">
                        <p className={`font-medium ${text.primary}`}>{item.processNumber}</p>
                        <p className={text.faint}>
                          {[item.courtClass, item.tribunal, item.degree ? `${item.degree}º grau` : null]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </p>
                        {item.partiesText !== null && (
                          <p className={`mt-0.5 max-w-[240px] truncate ${text.faint}`} title={item.partiesText}>
                            {item.partiesText}
                          </p>
                        )}
                      </td>
                      <td className={`px-3 py-2.5 ${text.muted}`}>
                        <p>{item.vara ?? '—'}</p>
                        <p className={text.faint}>{item.comarca ?? ''}</p>
                      </td>
                      <td className="max-w-[260px] px-3 py-2.5">
                        <p className={`${text.muted} line-clamp-2`} title={item.lastMovementText ?? ''}>
                          {item.lastMovementText ?? '—'}
                        </p>
                        <p className={text.faint}>{formatDate(item.lastMovementAt)}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}
                          title={item.priorityReason ?? undefined}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {item.needsAutos && !item.autosDownloaded && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              <TriangleAlert className="h-3 w-3" /> precisa de autos
                            </span>
                          )}
                          {item.isSealed && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                              <Lock className="h-3 w-3" /> segredo
                            </span>
                          )}
                          {item.clientId === null && item.executionCaseId === null && (
                            <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              sem cliente
                            </span>
                          )}
                          {item.executionCaseId !== null && (
                            <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              caso criado
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.executionCaseId !== null ? (
                            <Link
                              href={`/cases/${item.executionCaseId}`}
                              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                            >
                              Abrir caso <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPromoteItem(item)}
                              className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
                            >
                              Promover a caso
                            </button>
                          )}
                          {item.reviewStatus !== 'not_ours' && item.executionCaseId === null && (
                            <button
                              type="button"
                              onClick={() =>
                                patchItem.mutate({ itemId: item.id, patch: { reviewStatus: 'not_ours' } })
                              }
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-100"
                            >
                              Não é nosso
                            </button>
                          )}
                          {item.link !== null && (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-100"
                            >
                              Ver no tribunal
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-3 py-2">
              <p className={`text-[11px] ${text.faint}`}>
                {items.length} de {itemsQuery.data?.total ?? items.length} processo(s)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
