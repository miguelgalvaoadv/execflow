'use client'

/**
 * Document Central — org-wide operational document list.
 *
 * Data: GET /api/v1/documents (cursor pagination, filters, search).
 * Entry to document detail: /documents/[documentId]
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useDocuments } from '@/lib/hooks/use-documents'
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
} from '@/components/ui'
import {
  DOCUMENT_STATUS_FILTER_OPTIONS,
  documentStatusLabel,
  ocrStatusLabel,
} from '@/lib/operational/document-display'

/**
 * Ícone decorativo derivado da extensão do fileName.
 * Não usa mimeType (ausente no DocumentListItem).
 */
function docFileIcon(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return '📄'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff'].includes(ext)) return '🖼️'
  if (['doc', 'docx'].includes(ext)) return '🗎️'
  if (['zip', 'rar', '7z', 'tar'].includes(ext)) return '📦'
  return '🗋️'
}

/** Badge class semântica por status documental. */
function docStatusBadgeClass(status: string): string {
  if (status === 'confirmed') return 'text-emerald-400 bg-emerald-950/40 border-emerald-900/40'
  if (status === 'extraction_review') return 'text-blue-400 bg-blue-950/40 border-blue-900/40'
  if (status === 'extraction_running') return 'text-indigo-400 bg-indigo-950/30 border-indigo-900/30'
  if (status === 'rejected') return 'text-red-400 bg-red-950/40 border-red-900/40'
  if (status === 'archived' || status === 'superseded') return 'text-zinc-500 bg-white/[0.02] border-white/[0.04]'
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

export default function DocumentsPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')

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
      ...(classFilter.trim() !== '' ? { documentClass: classFilter.trim() } : {}),
    }),
    [debouncedQ, statusFilter, classFilter]
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
  } = useDocuments({
    organizationId: session?.organization.id ?? '',
    filters,
    enabled: session !== null && session !== undefined,
  })

  const items = data?.pages.flatMap((page) => page.data) ?? []
  const hasActiveFilters =
    debouncedQ !== '' || statusFilter !== '' || classFilter.trim() !== ''

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Peças"
        description="Peças processuais, minutas e documentos protocolados."
      />

      <div className="mt-6 space-y-4">
        <FilterBar>
          <SearchField
            id="doc-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Nome, classe ou ref. do caso…"
          />
          <FilterSelect
            id="doc-status"
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={DOCUMENT_STATUS_FILTER_OPTIONS}
            width="select-md"
          />
          <FilterTextField
            id="doc-class"
            label="Classe"
            value={classFilter}
            onChange={setClassFilter}
            placeholder="Ex.: sentenca"
            width="text-xs"
          />
        </FilterBar>

        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : isLoading ? (
          <LoadingState label="Carregando peças…" />
        ) : isError ? (
          <ErrorState
            message={error?.message ?? 'Erro ao carregar peças.'}
            onRetry={() => { void refetch() }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'Nenhuma peça encontrada' : 'Nenhuma peça'}
            description={
              hasActiveFilters
                ? 'Nenhum documento corresponde aos filtros actuais.'
                : 'Os documentos da organização aparecerão aqui.'
            }
          />
        ) : (
          <div className="space-y-2">
            <p className={`text-[12px] ${text.faint} mb-3`}>
              {items.length} {items.length === 1 ? 'peça' : 'peças'}
              {hasActiveFilters ? ' encontrada(s)' : ''}
            </p>
            <ul className="space-y-2" aria-label="Peças">
              {items.map((item) => (
                <li key={item.id}>
                  <ListCard href={`/documents/${item.id}`}>
                    <div className="flex items-start gap-3">
                      {/* Ícone decorativo por extensão */}
                      <span
                        className="shrink-0 text-[18px] leading-none mt-0.5"
                        aria-hidden="true"
                      >
                        {docFileIcon(item.fileName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                          <p className={`text-[13px] font-medium ${text.secondary} truncate`}>
                            {item.fileName}
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={[
                                'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]',
                                docStatusBadgeClass(item.status),
                              ].join(' ')}
                            >
                              {documentStatusLabel(item.status)}
                            </span>
                            <span className={`text-[11px] ${text.faint} tabular-nums`}>
                              {formatDateTime(item.uploadedAt)}
                            </span>
                          </div>
                        </div>
                        <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] ${text.faint}`}>
                          {item.documentClass !== null && <span>Classe: {item.documentClass}</span>}
                          <span>OCR: {ocrStatusLabel(item.ocrStatus)}</span>
                          {item.caseInternalRef !== null && (
                            <span>Caso: {item.caseInternalRef}</span>
                          )}
                        </div>
                      </div>
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
          </div>
        )}
      </div>
    </div>
  )
}
