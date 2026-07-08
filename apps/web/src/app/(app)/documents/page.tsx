'use client'

/**
 * Document Central — org-wide operational document list.
 *
 * Data: GET /api/v1/documents (cursor pagination, filters, search).
 * Entry to document detail: /documents/[documentId]
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FileText, Image as ImageIcon, File, ChevronRight, type LucideIcon } from 'lucide-react'
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
  LoadingState,
  SearchField,
} from '@/components/ui'
import {
  DOCUMENT_STATUS_FILTER_OPTIONS,
  documentStatusLabel,
  ocrStatusLabel,
} from '@/lib/operational/document-display'
import { documentClassLabel } from '@/lib/operational/labels'

function docIcon(fileName: string): LucideIcon {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff'].includes(ext)) return ImageIcon
  if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) return FileText
  return File
}

/** Badge class semântica por status documental. */
function docStatusBadgeClass(status: string): string {
  if (status === 'confirmed') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (status === 'extraction_review') return 'text-blue-700 bg-blue-50 border-blue-200'
  if (status === 'extraction_running') return 'text-blue-700 bg-blue-50 border-blue-200'
  if (status === 'rejected') return 'text-red-700 bg-red-50 border-red-200'
  if (status === 'archived' || status === 'superseded') return 'text-slate-500 bg-slate-100 border-slate-200'
  return 'text-slate-600 bg-slate-100 border-slate-200'
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
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
        title="Peças e documentos"
        description="Peças processuais, minutas e documentos do escritório."
      />

      <div className="space-y-4">
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
            placeholder="Ex.: sentença"
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
                ? 'Nenhum documento corresponde aos filtros atuais.'
                : 'Os documentos do escritório aparecerão aqui.'
            }
          />
        ) : (
          <div className="space-y-3">
            <p className={`text-[12px] ${text.muted}`}>
              {items.length} {items.length === 1 ? 'peça' : 'peças'}
              {hasActiveFilters ? ' encontrada(s)' : ''}
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const Icon = docIcon(item.fileName)
                return (
                  <Link
                    key={item.id}
                    href={`/documents/${item.id}`}
                    className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-slate-900 group-hover:text-blue-700" title={item.fileName}>
                            {item.fileName}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {documentClassLabel(item.documentClass)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={[
                          'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-medium',
                          docStatusBadgeClass(item.status),
                        ].join(' ')}
                      >
                        {documentStatusLabel(item.status)}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                          OCR
                        </p>
                        <p className="mt-0.5 truncate text-[12px] font-medium text-slate-800">
                          {ocrStatusLabel(item.ocrStatus, item.status)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                          Enviado
                        </p>
                        <p className="mt-0.5 truncate text-[12px] font-medium text-slate-800">
                          {formatDate(item.uploadedAt)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[12px]">
                      <span className="truncate text-slate-500">
                        {item.caseInternalRef !== null ? `Caso: ${item.caseInternalRef}` : 'Sem caso vinculado'}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-blue-600">
                        Abrir
                        <ChevronRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </Link>
                )
              })}
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
