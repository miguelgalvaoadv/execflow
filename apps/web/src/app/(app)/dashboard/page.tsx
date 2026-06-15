'use client'

/**
 * Operational Dashboard MVP — Início
 *
 * Route: /dashboard
 * Data: existing org-scoped APIs only (no new backend).
 *
 * Architecture ref: Dashboard Product Readiness Report (2026-05-27).
 */

import { useMemo } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/hooks/use-session'
import { useQueueProjections, type QueueProjectionItem } from '@/lib/hooks/use-queue-projections'
import { useDeadlines } from '@/lib/hooks/use-deadlines'
import { useDocuments } from '@/lib/hooks/use-documents'
import { useCases } from '@/lib/hooks/use-cases'
import { useEngineRuns } from '@/lib/hooks/use-engine-runs'
import {
  DashboardPageHeader,
  SummaryMetricCard,
  QueueProjectionRow,
  WorkspacePanel,
} from '@/components/dashboard'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import {
  EmptyState,
  ErrorState,
  ListCard,
  LoadingState,
  StatusBadge,
} from '@/components/ui'
import {
  deadlineCardAccentClass,
  deadlineClassLabel,
} from '@/lib/operational/deadline-display'
import { documentStatusLabel } from '@/lib/operational/document-display'

const COUNT_LIMIT = 50

const DOCUMENT_PIPELINE_GROUPS = [
  { status: 'pending_extraction', label: 'Aguardando extração' },
  { status: 'extraction_running', label: 'Extração em curso' },
  { status: 'extraction_review', label: 'Em revisão' },
  { status: 'confirmed', label: 'Confirmado' },
] as const

const QUICK_LINKS = [
  { href: '/cases', label: 'Execuções', description: 'Casos e workspace' },
  { href: '/clients', label: 'Clientes', description: 'Registo de clientes' },
  { href: '/documents', label: 'Peças', description: 'Central documental' },
  { href: '/deadlines', label: 'Prazos', description: 'Central de prazos' },
  { href: '/queues', label: 'Filas', description: 'Fila de trabalho completa' },
] as const

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function mergePriorityQueueItems(items: QueueProjectionItem[]): QueueProjectionItem[] {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const aKey = a.keyDate ?? a.slaDeadlineAt ?? a.createdAt
    const bKey = b.keyDate ?? b.slaDeadlineAt ?? b.createdAt
    return new Date(aKey).getTime() - new Date(bKey).getTime()
  })
}

function isDueWithinWeek(dueAt: string): boolean {
  const due = new Date(dueAt)
  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(weekEnd.getDate() + 7)
  return due <= weekEnd
}

function PanelFooterLink({ href, label }: { href: string; label: string }) {
  return (
    <div className={`mt-4 border-t ${borders.subtle} pt-3`}>
      <Link
        href={href}
        className={`text-[12px] ${text.faint} hover:text-zinc-300 transition-colors`}
      >
        {label} →
      </Link>
    </div>
  )
}

export default function DashboardPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''
  const sessionReady = session !== null && session !== undefined

  const workQueue = useQueueProjections({
    organizationId: orgId,
    limit: COUNT_LIMIT,
    enabled: sessionReady,
  })

  const intakeReview = useQueueProjections({
    organizationId: orgId,
    queueType: 'intake_review',
    limit: COUNT_LIMIT,
    enabled: sessionReady,
  })

  const extractionReviewQueue = useQueueProjections({
    organizationId: orgId,
    queueType: 'extraction_review',
    limit: COUNT_LIMIT,
    enabled: sessionReady,
  })

  const snapshotReviewQueue = useQueueProjections({
    organizationId: orgId,
    queueType: 'snapshot_review',
    limit: COUNT_LIMIT,
    enabled: sessionReady,
  })

  const libertyQueue = useQueueProjections({
    organizationId: orgId,
    queueType: 'urgent_liberty_risks',
    limit: 15,
    enabled: sessionReady,
  })

  const overdueQueue = useQueueProjections({
    organizationId: orgId,
    queueType: 'overdue_deadlines',
    limit: 15,
    enabled: sessionReady,
  })

  const opportunityQueue = useQueueProjections({
    organizationId: orgId,
    queueType: 'opportunity_review',
    limit: 15,
    enabled: sessionReady,
  })

  const extractionPriorityQueue = useQueueProjections({
    organizationId: orgId,
    queueType: 'extraction_review',
    limit: 15,
    enabled: sessionReady,
  })

  const snapshotPriorityQueue = useQueueProjections({
    organizationId: orgId,
    queueType: 'snapshot_review',
    limit: 15,
    enabled: sessionReady,
  })

  const overdueDeadlines = useDeadlines({
    organizationId: orgId,
    filters: { status: 'overdue' },
    limit: COUNT_LIMIT,
    enabled: sessionReady,
  })

  const weekDeadlinesQuery = useDeadlines({
    organizationId: orgId,
    limit: COUNT_LIMIT,
    enabled: sessionReady,
  })

  const activeCases = useCases({
    organizationId: orgId,
    filters: { status: 'active' },
    limit: COUNT_LIMIT,
    enabled: sessionReady,
  })

  const pendingExtraction = useDocuments({
    organizationId: orgId,
    filters: { status: 'pending_extraction' },
    limit: 5,
    enabled: sessionReady,
  })

  const extractionRunning = useDocuments({
    organizationId: orgId,
    filters: { status: 'extraction_running' },
    limit: 5,
    enabled: sessionReady,
  })

  const extractionReviewDocs = useDocuments({
    organizationId: orgId,
    filters: { status: 'extraction_review' },
    limit: 5,
    enabled: sessionReady,
  })

  const confirmedDocs = useDocuments({
    organizationId: orgId,
    filters: { status: 'confirmed' },
    limit: 5,
    enabled: sessionReady,
  })

  const engineRuns = useEngineRuns(orgId, undefined, sessionReady, 5)

  const reviewsPendingCount = useMemo(() => {
    if (!intakeReview.data || !extractionReviewQueue.data || !snapshotReviewQueue.data) {
      return null
    }
    return (
      intakeReview.data.data.length +
      extractionReviewQueue.data.data.length +
      snapshotReviewQueue.data.data.length
    )
  }, [intakeReview.data, extractionReviewQueue.data, snapshotReviewQueue.data])

  const priorityItems = useMemo(() => {
    const batches = [
      libertyQueue.data?.data ?? [],
      overdueQueue.data?.data ?? [],
      opportunityQueue.data?.data ?? [],
      extractionPriorityQueue.data?.data ?? [],
      snapshotPriorityQueue.data?.data ?? [],
    ]
    return mergePriorityQueueItems(batches.flat()).slice(0, 10)
  }, [
    libertyQueue.data,
    overdueQueue.data,
    opportunityQueue.data,
    extractionPriorityQueue.data,
    snapshotPriorityQueue.data,
  ])

  const priorityLoading =
    libertyQueue.isLoading ||
    overdueQueue.isLoading ||
    opportunityQueue.isLoading ||
    extractionPriorityQueue.isLoading ||
    snapshotPriorityQueue.isLoading

  const priorityError =
    libertyQueue.error ??
    overdueQueue.error ??
    opportunityQueue.error ??
    extractionPriorityQueue.error ??
    snapshotPriorityQueue.error

  const weekDeadlines = useMemo(() => {
    const items = weekDeadlinesQuery.data?.pages.flatMap((p) => p.data) ?? []
    return items
      .filter(
        (d) =>
          !['completed', 'dismissed'].includes(d.status) && isDueWithinWeek(d.dueAt)
      )
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 5)
  }, [weekDeadlinesQuery.data])

  const documentPipeline = [
    { ...DOCUMENT_PIPELINE_GROUPS[0], query: pendingExtraction },
    { ...DOCUMENT_PIPELINE_GROUPS[1], query: extractionRunning },
    { ...DOCUMENT_PIPELINE_GROUPS[2], query: extractionReviewDocs },
    { ...DOCUMENT_PIPELINE_GROUPS[3], query: confirmedDocs },
  ] as const

  const pipelineLoading = documentPipeline.some((g) => g.query.isLoading)
  const pipelineError = documentPipeline.find((g) => g.query.isError)?.query.error

  if (sessionLoading) {
    return <LoadingState label="Carregando sessão…" />
  }

  if (session === null || session === undefined) {
    return <ErrorState message="Sessão não encontrada. Faça login novamente." />
  }

  const roleLabel =
    session.role === 'admin'
      ? 'Administrador'
      : session.role === 'lawyer'
        ? 'Advogado'
        : 'Assistente'

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Início"
        title={session.organization.name}
        description={`Centro operacional · ${roleLabel}`}
      />

      <div className="mt-6 space-y-6">
        {/* Section 1 — Resumo operacional */}
        <section aria-label="Resumo operacional">
          <h2 className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${text.muted} mb-3`}>
            Resumo operacional
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetricCard
              title="Trabalho pendente"
              count={workQueue.data?.data.length ?? null}
              countLimit={COUNT_LIMIT}
              href="/queues"
              loading={workQueue.isLoading}
              description="Itens na fila operacional"
            />
            <SummaryMetricCard
              title="Reviews pendentes"
              count={reviewsPendingCount}
              countLimit={COUNT_LIMIT * 3}
              href="/queues"
              loading={
                intakeReview.isLoading ||
                extractionReviewQueue.isLoading ||
                snapshotReviewQueue.isLoading
              }
              description="Intake, extração e snapshot"
            />
            <SummaryMetricCard
              title="Prazos vencidos"
              count={overdueDeadlines.data?.pages[0]?.data.length ?? null}
              countLimit={COUNT_LIMIT}
              href="/deadlines"
              loading={overdueDeadlines.isLoading}
              description="Status vencido"
            />
            <SummaryMetricCard
              title="Casos activos"
              count={activeCases.data?.pages[0]?.data.length ?? null}
              countLimit={COUNT_LIMIT}
              href="/cases"
              loading={activeCases.isLoading}
              description="Execuções em curso"
            />
          </div>
        </section>

        {/* Section 2 — Fila prioritária */}
        <WorkspacePanel
          title="Fila prioritária"
          description="Riscos à liberdade, prazos vencidos, oportunidades e revisões críticas."
          className="min-h-0"
        >
          {priorityLoading ? (
            <LoadingState label="Carregando fila prioritária…" />
          ) : priorityError !== null && priorityError !== undefined ? (
            <ErrorState
              message={priorityError.message ?? 'Erro ao carregar fila prioritária.'}
              onRetry={() => {
                void libertyQueue.refetch()
                void overdueQueue.refetch()
                void opportunityQueue.refetch()
                void extractionPriorityQueue.refetch()
                void snapshotPriorityQueue.refetch()
              }}
            />
          ) : priorityItems.length === 0 ? (
            <EmptyState
              title="Sem itens prioritários"
              description="Nenhum item nas filas críticas seleccionadas."
            />
          ) : (
            <>
              <ul className="space-y-2" aria-label="Fila prioritária">
                {priorityItems.map((item) => (
                  <QueueProjectionRow key={item.id} item={item} />
                ))}
              </ul>
              <PanelFooterLink href="/queues" label="Ver fila completa" />
            </>
          )}
        </WorkspacePanel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Section 3 — Prazos da semana */}
          <WorkspacePanel
            title="Prazos da semana"
            description="Vencimentos nos próximos 7 dias (inclui vencidos recentes)."
          >
            {weekDeadlinesQuery.isLoading ? (
              <LoadingState label="Carregando prazos…" />
            ) : weekDeadlinesQuery.isError ? (
              <ErrorState
                message={weekDeadlinesQuery.error.message ?? 'Erro ao carregar prazos.'}
                onRetry={() => { void weekDeadlinesQuery.refetch() }}
              />
            ) : weekDeadlines.length === 0 ? (
              <EmptyState
                title="Sem prazos esta semana"
                description="Nenhum prazo activo vence nos próximos 7 dias."
              />
            ) : (
              <>
                <ul className="space-y-2" aria-label="Prazos da semana">
                  {weekDeadlines.map((deadline) => {
                    const accent = deadlineCardAccentClass(deadline.status, deadline.priority)
                    return (
                      <li key={deadline.id}>
                        <ListCard
                          href={`/deadlines/${deadline.id}`}
                          accentClassName={accent}
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <StatusBadge variant="deadline" status={deadline.status} />
                            <span className={`text-[11px] ${text.faint}`}>
                              {deadlineClassLabel(deadline.deadlineClass)}
                            </span>
                          </div>
                          <p className={`text-[13px] font-medium ${text.secondary}`}>
                            {deadline.title}
                          </p>
                          <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                            Vencimento: {formatDateTime(deadline.dueAt)}
                            {deadline.caseInternalRef !== null
                              ? ` · ${deadline.caseInternalRef}`
                              : ''}
                          </p>
                        </ListCard>
                      </li>
                    )
                  })}
                </ul>
                <PanelFooterLink href="/deadlines" label="Ver todos os prazos" />
              </>
            )}
          </WorkspacePanel>

          {/* Section 4 — Pipeline documental */}
          <WorkspacePanel
            title="Pipeline documental"
            description="Peças por estado do pipeline de extracção."
          >
            {pipelineLoading ? (
              <LoadingState label="Carregando peças…" />
            ) : pipelineError !== null && pipelineError !== undefined ? (
              <ErrorState
                message={pipelineError.message ?? 'Erro ao carregar pipeline.'}
                onRetry={() => {
                  void pendingExtraction.refetch()
                  void extractionRunning.refetch()
                  void extractionReviewDocs.refetch()
                  void confirmedDocs.refetch()
                }}
              />
            ) : (
              <>
                <div className="space-y-4">
                  {documentPipeline.map((group) => {
                    const items = group.query.data?.pages.flatMap((p) => p.data) ?? []
                    return (
                      <div key={group.status}>
                        <div className="flex items-baseline justify-between gap-2 mb-2">
                          <h3 className={`text-[12px] font-medium ${text.secondary}`}>
                            {group.label}
                          </h3>
                          <span className={`text-[11px] tabular-nums ${text.faint}`}>
                            {items.length}
                            {items.length >= 5 ? '+' : ''}
                          </span>
                        </div>
                        {items.length === 0 ? (
                          <p className={`text-[11px] ${text.faint}`}>Nenhuma peça.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {items.slice(0, 3).map((doc) => (
                            <li key={doc.id}>
                            <ListCard href={`/documents/${doc.id}`}>
                              <p className={`text-[12px] font-medium ${text.secondary} truncate`}>
                                {doc.fileName}
                              </p>
                              <p className={`text-[10px] ${text.faint}`}>
                                {documentStatusLabel(doc.status)}
                              </p>
                            </ListCard>
                          </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
                <PanelFooterLink href="/documents" label="Ver central documental" />
              </>
            )}
          </WorkspacePanel>

          {/* Section 5 — Motor */}
          <WorkspacePanel
            title="Actividade recente"
            description="Últimas avaliações do motor de cálculo."
          >
            {engineRuns.isLoading ? (
              <LoadingState label="Carregando avaliações…" />
            ) : engineRuns.isError ? (
              <ErrorState
                message={engineRuns.error.message ?? 'Erro ao carregar motor.'}
                onRetry={() => { void engineRuns.refetch() }}
              />
            ) : engineRuns.data === undefined || engineRuns.data.data.length === 0 ? (
              <EmptyState
                title="Sem avaliações recentes"
                description="Execuções do motor aparecerão aqui."
              />
            ) : (
              <>
                <ul className="space-y-2" aria-label="Actividade do motor">
                  {engineRuns.data.data.map((run) => (
                    <li key={run.id}>
                      <ListCard href={`/cases/${run.executionCaseId}`}>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <StatusBadge>{run.trigger}</StatusBadge>
                          <span className={`text-[11px] ${text.faint}`}>{run.status}</span>
                          {run.uncertaintyLevel !== null && (
                            <span className={`text-[11px] ${text.faint}`}>
                              Incerteza: {run.uncertaintyLevel}
                            </span>
                          )}
                        </div>
                        {run.evaluatedAt !== null && (
                          <p className={`text-[11px] ${text.faint}`}>
                            {formatDateTime(run.evaluatedAt)}
                          </p>
                        )}
                        {run.opportunitiesCreated !== null &&
                          Array.isArray(run.opportunitiesCreated) && (
                            <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                              Oportunidades criadas: {run.opportunitiesCreated.length}
                            </p>
                          )}
                      </ListCard>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </WorkspacePanel>

          {/* Section 6 — Acesso rápido */}
          <WorkspacePanel title="Acesso rápido" description="Módulos operacionais.">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={[
                      'block rounded-lg border px-4 py-3 transition-colors hover:bg-white/[0.02]',
                      borders.subtle,
                      surfaces.panelInset,
                    ].join(' ')}
                  >
                    <p className={`text-[13px] font-medium ${text.secondary}`}>{link.label}</p>
                    <p className={`mt-0.5 text-[11px] ${text.faint}`}>{link.description}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </WorkspacePanel>
        </div>
      </div>
    </div>
  )
}
