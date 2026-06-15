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
import {
  EmptyState,
  ErrorState,
  ListCard,
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
    return 'text-red-400 bg-red-950/40 border-red-900/40'
  // Benefício penal
  if (['progression', 'remission', 'detraction', 'amnesty', 'commutation'].includes(type))
    return 'text-emerald-400 bg-emerald-950/40 border-emerald-900/40'
  // Disciplinar
  if (type === 'pad_challenge')
    return 'text-amber-400 bg-amber-950/40 border-amber-900/40'
  // Cálculo / motor
  if (type === 'recalculation')
    return 'text-indigo-400 bg-indigo-950/30 border-indigo-900/30'
  // Manual / genérico
  return 'text-zinc-400 bg-white/[0.03] border-white/[0.06]'
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
            <ul className="space-y-2" aria-label="Oportunidades pendentes">
              {allOpportunities.map((item) => {
                const meta = item.metadata as Record<string, string> | null
                const opportunityType = meta?.['opportunityType'] ?? 'manual'
                const confidenceLevel = meta?.['confidenceLevel']
                const source = meta?.['source']
                return (
                  <li key={item.id}>
                    <ListCard variant="link" href={item.executionCaseId ? `/cases/${item.executionCaseId}?tab=opportunities` : '#'}>
                      <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span
                            className={[
                              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]',
                              opportunityTypeBadgeClass(opportunityType),
                            ].join(' ')}
                          >
                            {OPPORTUNITY_TYPE_LABELS[opportunityType] ?? opportunityType}
                          </span>
                          {source === 'engine' && (
                            <span
                              className={`inline-flex items-center rounded border border-indigo-900/40 bg-indigo-950/30 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400`}
                            >
                              Motor
                            </span>
                          )}
                          {confidenceLevel !== undefined && (
                            <span className={`text-[11px] ${text.faint}`}>
                              {confidenceLevel === 'high'
                                ? 'alta confiança'
                                : confidenceLevel === 'medium'
                                  ? 'confiança média'
                                  : 'baixa confiança'}
                            </span>
                          )}
                        </div>
                        <p className={`text-[13px] ${text.secondary} font-medium`}>
                          {item.displayTitle}
                        </p>
                        {item.keyDate !== null && (
                          <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                            Janela:{' '}
                            {new Intl.DateTimeFormat('pt-BR').format(new Date(item.keyDate))}
                          </p>
                        )}
                      </div>
                      </div>
                    </ListCard>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
