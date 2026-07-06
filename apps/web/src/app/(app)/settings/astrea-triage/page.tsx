'use client'

/**
 * Astrea Triage — e-mails que o pipeline automático não conseguiu vincular a
 * um caso (CNJ não encontrado) ou não conseguiu extrair (formato
 * inesperado). Nada aqui foi descartado — fica visível até alguém resolver.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useSession } from '@/lib/hooks/use-session'
import { DashboardPageHeader } from '@/components/dashboard'
import { apiGet, apiPost, ApiError } from '@/lib/api-client'
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui'

type AstreaEmailLogItem = {
  id: string
  emailSubject: string | null
  emailFrom: string | null
  emailReceivedAt: string | null
  rawBodySnapshot: string | null
  status: 'orphan' | 'parse_failed' | 'processed' | 'duplicate' | 'ignored_no_cnj'
  extractedCnj: string | null
  errorDetails: string | null
  createdAt: string
}

function formatDateTime(iso: string | null): string {
  if (iso === null) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function TriageCard({ item, organizationId }: { item: AstreaEmailLogItem; organizationId: string }) {
  const queryClient = useQueryClient()
  const [caseIdInput, setCaseIdInput] = useState('')
  const [submitting, setSubmitting] = useState<'link' | 'ignore' | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  async function resolve(action: 'link' | 'ignore') {
    setLocalError(null)
    if (action === 'link' && caseIdInput.trim() === '') {
      setLocalError('Informe o ID do caso para vincular.')
      return
    }
    setSubmitting(action)
    try {
      await apiPost(
        `/api/v1/astrea/triage/${item.id}/resolve`,
        action === 'link' ? { action: 'link', executionCaseId: caseIdInput.trim() } : { action: 'ignore' },
        { organizationId }
      )
      await queryClient.invalidateQueries({ queryKey: ['astrea-triage', organizationId] })
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : 'Falha ao resolver.')
    } finally {
      setSubmitting(null)
    }
  }

  const statusLabel = item.status === 'orphan' ? 'Processo não encontrado' : 'Falha ao ler o e-mail'
  const statusClass =
    item.status === 'orphan'
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-rose-50 border-rose-200 text-rose-700'

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-900 truncate">
            {item.emailSubject ?? '(sem assunto)'}
          </p>
          <p className="text-[11px] text-slate-500">
            {item.emailFrom ?? 'remetente desconhecido'} · {formatDateTime(item.emailReceivedAt ?? item.createdAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      {item.extractedCnj !== null && (
        <p className="mt-2 text-[12px] text-slate-600">
          CNJ extraído: <span className="font-mono text-slate-800">{item.extractedCnj}</span>
        </p>
      )}
      {item.errorDetails !== null && (
        <p className="mt-1 text-[12px] text-slate-500">Detalhe: {item.errorDetails}</p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-[11px] font-medium text-blue-600 hover:underline"
      >
        {expanded ? 'Ocultar corpo do e-mail' : 'Ver corpo do e-mail'}
      </button>
      {expanded && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-[11px] text-slate-700">
          {item.rawBodySnapshot ?? '(vazio)'}
        </pre>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <input
          type="text"
          value={caseIdInput}
          onChange={(e) => setCaseIdInput(e.target.value)}
          placeholder="ID do caso (UUID) para vincular"
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
        />
        <Button size="sm" onClick={() => { void resolve('link') }} disabled={submitting !== null}>
          {submitting === 'link' ? 'Vinculando…' : 'Vincular ao caso'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => { void resolve('ignore') }} disabled={submitting !== null}>
          {submitting === 'ignore' ? 'Marcando…' : 'Não é movimentação'}
        </Button>
      </div>
      {localError !== null && <p className="mt-2 text-[11px] text-rose-600">{localError}</p>}
    </div>
  )
}

export default function AstreaTriagePage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const organizationId = session?.organization.id ?? ''

  const query = useQuery<{ data: AstreaEmailLogItem[] }, ApiError>({
    queryKey: ['astrea-triage', organizationId],
    queryFn: ({ signal }) => apiGet(`/api/v1/astrea/triage`, { organizationId, signal }),
    enabled: organizationId !== '',
    refetchInterval: 60_000,
  })

  const items = query.data?.data ?? []

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Astrea"
        title="Movimentações não identificadas"
        description="E-mails do Astrea que o sistema não conseguiu vincular automaticamente a um caso. Nada é descartado — resolva aqui manualmente."
      />

      <div className="mt-2">
        <Link href="/settings" className="text-[12px] font-medium text-blue-600 hover:underline">
          ← Voltar para Configurações
        </Link>
      </div>

      <div className="mt-6 space-y-3">
        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : query.isLoading ? (
          <LoadingState label="Carregando triagem…" />
        ) : query.isError ? (
          <ErrorState
            message={query.error?.message ?? 'Erro ao carregar.'}
            onRetry={() => { void query.refetch() }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nada pendente"
            description="Todos os e-mails do Astrea foram processados ou já estão vinculados a um caso."
          />
        ) : (
          items.map((item) => <TriageCard key={item.id} item={item} organizationId={organizationId} />)
        )}
      </div>
    </div>
  )
}
