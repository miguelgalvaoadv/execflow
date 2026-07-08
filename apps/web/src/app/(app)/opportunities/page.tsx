'use client'

/**
 * Opportunities surface — org-wide triage of suggested opportunities.
 *
 * Lê diretamente a tabela opportunities (GET /api/v1/opportunities), não mais
 * queue_projections. Achado 08/07/2026: a versão anterior dependia de
 * queue_projections, que só é alimentada pelo fluxo de extraction-promotion
 * (e-mail/scan) — oportunidades geradas por "Analisar autos" (o caminho mais
 * comum hoje) nunca apareciam aqui, só dentro de cada caso.
 *
 * What is real: session, org context, GET /api/v1/opportunities (org-wide).
 * AI_BOUNDARIES.md: frontend never evaluates or derives opportunities.
 */

import { useSession } from '@/lib/hooks/use-session'
import { useOpportunities } from '@/lib/hooks/use-opportunities'
import { DashboardPageHeader } from '@/components/dashboard'
import { text } from '@/components/dashboard/surfaces'
import { OPPORTUNITY_TYPE_LABELS } from '@/lib/operational/queue-display'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Button,
} from '@/components/ui'

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
  const orgId = session?.organization.id ?? ''

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useOpportunities({
    organizationId: orgId,
    filters: { status: 'suggested' },
  })

  const items = data?.pages.flatMap((page) => page.data) ?? []

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Oportunidades"
        description="Sugestões pendentes de revisão jurídica, de todos os casos. Apenas advogados qualificam."
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
        ) : items.length === 0 ? (
          <EmptyState
            title="Sem oportunidades pendentes"
            description="Oportunidades sugeridas (pela IA ou pelo motor) aparecerão aqui para revisão jurídica."
          />
        ) : (
          <div>
            <p className={`text-[12px] ${text.faint} mb-3`}>
              {items.length} {items.length === 1 ? 'oportunidade' : 'oportunidades'} aguardando revisão
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const confidenceText =
                  item.confidenceLevel === 'high'
                    ? 'Alta confiança'
                    : item.confidenceLevel === 'medium'
                      ? 'Confiança média'
                      : item.confidenceLevel === 'low'
                        ? 'Baixa confiança'
                        : null
                return (
                  <Link
                    key={item.id}
                    href={`/cases/${item.executionCaseId}?tab=oportunidades`}
                    className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={[
                          'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium',
                          opportunityTypeBadgeClass(item.opportunityType),
                        ].join(' ')}
                      >
                        {OPPORTUNITY_TYPE_LABELS[item.opportunityType] ?? item.opportunityType}
                      </span>
                      {item.caseInternalRef !== null && (
                        <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {item.caseInternalRef}
                        </span>
                      )}
                    </div>
                    <p className="mt-2.5 text-[14px] font-semibold leading-snug text-slate-900 group-hover:text-blue-700">
                      {item.summary}
                    </p>
                    {confidenceText !== null && (
                      <p className="mt-1 text-[12px] text-slate-500">{confidenceText}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[12px]">
                      <span className="text-slate-500">
                        {item.windowEndAt !== null
                          ? `Janela: ${new Intl.DateTimeFormat('pt-BR').format(new Date(item.windowEndAt))}`
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
            {hasNextPage && (
              <div className="mt-5 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={() => { void fetchNextPage() }}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
