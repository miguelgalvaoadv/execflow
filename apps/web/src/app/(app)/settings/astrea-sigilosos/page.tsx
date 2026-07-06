'use client'

/**
 * Painel de processos em segredo de justiça — lembrete operacional, não
 * automação. O Astrea não expõe nenhum sinal de que a senha de um tribunal
 * sigiloso expirou, então este painel existe para o advogado revisar
 * manualmente e registrar que conferiu.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useSession } from '@/lib/hooks/use-session'
import { DashboardPageHeader } from '@/components/dashboard'
import { apiGet, apiPost, ApiError } from '@/lib/api-client'
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui'

type SealedCaseItem = {
  executionCaseId: string
  internalRef: string
  executionProcessNumber: string | null
  clientName: string
  astreaSealedCredentialStatus: string | null
  astreaSealedCredentialUpdatedAt: string | null
  astreaSealedCredentialReviewDueAt: string | null
  lastSyncedAt: string | null
  urgency: 'needs_setup' | 'possibly_expired' | 'overdue' | 'ok'
}

function formatDate(iso: string | null): string {
  if (iso === null) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}

const URGENCY_CONFIG: Record<SealedCaseItem['urgency'], { label: string; className: string }> = {
  needs_setup: { label: 'Cadastrar credencial no Astrea', className: 'bg-slate-100 border-slate-300 text-slate-700' },
  possibly_expired: { label: 'Possível senha expirada', className: 'bg-amber-50 border-amber-200 text-amber-700' },
  overdue: { label: 'Revisão atrasada', className: 'bg-amber-50 border-amber-200 text-amber-700' },
  ok: { label: 'Credencial em dia', className: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
}

function SealedCaseRow({ item, organizationId }: { item: SealedCaseItem; organizationId: string }) {
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)

  async function markVerified() {
    setSubmitting(true)
    try {
      await apiPost(
        `/api/v1/astrea/sealed-cases/${item.executionCaseId}/mark-verified`,
        { status: 'configured' },
        { organizationId }
      )
      await queryClient.invalidateQueries({ queryKey: ['astrea-sealed-cases', organizationId] })
    } finally {
      setSubmitting(false)
    }
  }

  const cfg = URGENCY_CONFIG[item.urgency]

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="min-w-0">
        <Link href={`/cases/${item.executionCaseId}`} className="text-[13px] font-semibold text-slate-900 hover:text-blue-700">
          {item.clientName}
        </Link>
        <p className="text-[11px] text-slate-500">
          {item.internalRef} {item.executionProcessNumber !== null ? `· ${item.executionProcessNumber}` : ''}
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          Revisão sugerida: {formatDate(item.astreaSealedCredentialReviewDueAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${cfg.className}`}>{cfg.label}</span>
        <Button size="sm" onClick={() => { void markVerified() }} disabled={submitting}>
          {submitting ? 'Salvando…' : 'Marcar como verificado hoje'}
        </Button>
      </div>
    </div>
  )
}

export default function AstreaSigilososPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const organizationId = session?.organization.id ?? ''

  const query = useQuery<{ data: SealedCaseItem[] }, ApiError>({
    queryKey: ['astrea-sealed-cases', organizationId],
    queryFn: ({ signal }) => apiGet(`/api/v1/astrea/sealed-cases`, { organizationId, signal }),
    enabled: organizationId !== '',
  })

  const items = query.data?.data ?? []

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Astrea"
        title="Processos em segredo de justiça"
        description="O Astrea não monitora segredo de justiça pelo e-mail automático — cada processo precisa de credencial cadastrada manualmente lá dentro (CPF + senha + código do tribunal). Use esta tela como lembrete de revisão periódica."
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
          <LoadingState label="Carregando…" />
        ) : query.isError ? (
          <ErrorState message={query.error?.message ?? 'Erro ao carregar.'} onRetry={() => { void query.refetch() }} />
        ) : items.length === 0 ? (
          <EmptyState title="Nenhum processo em segredo de justiça" description="Quando um caso for marcado como sigiloso, ele aparece aqui." />
        ) : (
          items.map((item) => <SealedCaseRow key={item.executionCaseId} item={item} organizationId={organizationId} />)
        )}
      </div>
    </div>
  )
}
