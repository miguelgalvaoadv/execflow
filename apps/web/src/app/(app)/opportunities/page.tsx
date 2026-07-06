'use client'

/**
 * Opportunities surface — engine-suggested and manually created opportunities.
 *
 * Opportunities surface the engine's non-binding proposals (status=suggested)
 * alongside qualified, deferred, and realized opportunities.
 *
 * Surfacing happens via the queue (opportunity_review queue type) rather than
 * a raw list — but this page provides the full list view for lawyers.
 *
 * What is real: session, org context, queue-derived opportunity items.
 * What is deferred: direct GET /api/v1/opportunities list endpoint (not yet built).
 *
 * AI_BOUNDARIES.md: frontend never evaluates or derives opportunities.
 * Architecture ref: ux-flow-architecture.md §5 (opportunity review flow).
 */

import { useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useQueueProjections } from '@/lib/hooks/use-queue-projections'
import { DashboardPageHeader } from '@/components/dashboard'
import { text } from '@/components/dashboard/surfaces'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui'

const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  progression: 'Progressão',
  remission: 'Remição',
  detraction: 'Detração',
  amnesty: 'Indulto',
  commutation: 'Comutação',
  hc: 'Habeas Corpus',
  pad_challenge: 'Impugnação PAD',
  prescription: 'Prescrição',
  recalculation: 'Recálculo',
  excess_execution: 'Excesso de execução',
  rights_violation: 'Violação de direitos',
  manual: 'Manual',
}

/** Badge class semântica por categoria de oportunidade. */
function opportunityTypeBadgeClass(type: string): string {
  // Liberdade / direitos
  if (['hc', 'prescription', 'excess_execution', 'rights_violation'].includes(type))
    return 'text-red-700 bg-red-50 border-red-200'
  // Benefício penal
  if (['progression', 'remission', 'detraction', 'amnesty', 'commutation'].includes(type))
    return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  // Disciplinar
  if (type === 'pad_challenge')
    return 'text-amber-700 bg-amber-50 border-amber-200'
  // Cálculo / motor
  if (type === 'recalculation')
    return 'text-blue-600 bg-blue-100 border-blue-200'
  // Manual / genérico
  return 'text-slate-600 bg-slate-50 border-slate-100'
}

export default function OpportunitiesPage() {
  const { data: session, isLoading: sessionLoading } = useSession()

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQueueProjections({
    organizationId: session?.organization.id ?? '',
    queueType: 'opportunity_review',
  })

  // Also fetch progression-specific queue
  const {
    data: progressionData,
  } = useQueueProjections({
    organizationId: session?.organization.id ?? '',
    queueType: 'progression_opportunities',
  })

  const allOpportunities = [
    ...(data?.data ?? []),
    ...(progressionData?.data ?? []),
  ].sort((a, b) => a.priority - b.priority)

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Oportunidades"
        description="Sugestões do motor de cálculo pendentes de revisão jurídica. Apenas advogados qualificam."
      />

      <div className="mt-6">
        {sessionLoading ? (
          <LoadingState label="Carregando…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada." />
        ) : isLoading ? (
          <LoadingState label="Carregando oportunidades…" />
        ) : isError ? (
          <ErrorState
            message={error?.message ?? 'Erro ao carregar oportunidades.'}
            onRetry={() => { void refetch() }}
          />
        ) : allOpportunities.length === 0 ? (
          <EmptyState
            title="Sem oportunidades pendentes"
            description="Oportunidades sugeridas pelo motor de cálculo aparecerão aqui para revisão jurídica."
          />
        ) : (
          <div>
            <p className={`text-[12px] ${text.faint} mb-3`}>
              {allOpportunities.length}{' '}
              {allOpportunities.length === 1 ? 'oportunidade' : 'oportunidades'} aguardando revisão
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {allOpportunities.map((item) => {
                const meta = item.metadata as Record<string, string> | null
                const opportunityType = meta?.['opportunityType'] ?? 'manual'
                const confidenceLevel = meta?.['confidenceLevel']
                const source = meta?.['source']
                const confidenceText =
                  confidenceLevel === 'high'
                    ? 'Alta confiança'
                    : confidenceLevel === 'medium'
                      ? 'Confiança média'
                      : confidenceLevel === 'low'
                        ? 'Baixa confiança'
                        : null
                return (
                  <Link
                    key={item.id}
                    href={item.executionCaseId ? `/cases/${item.executionCaseId}?tab=opportunities` : '#'}
                    className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={[
                          'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium',
                          opportunityTypeBadgeClass(opportunityType),
                        ].join(' ')}
                      >
                        {OPPORTUNITY_TYPE_LABELS[opportunityType] ?? opportunityType}
                      </span>
                      {source === 'engine' && (
                        <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          Motor
                        </span>
                      )}
                    </div>
                    <p className="mt-2.5 text-[14px] font-semibold leading-snug text-slate-900 group-hover:text-blue-700">
                      {item.displayTitle}
                    </p>
                    {confidenceText !== null && (
                      <p className="mt-1 text-[12px] text-slate-500">{confidenceText}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[12px]">
                      <span className="text-slate-500">
                        {item.keyDate !== null
                          ? `Janela: ${new Intl.DateTimeFormat('pt-BR').format(new Date(item.keyDate))}`
                          : 'Sem janela definida'}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-blue-600">
                        Ver no caso
                        <ChevronRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
