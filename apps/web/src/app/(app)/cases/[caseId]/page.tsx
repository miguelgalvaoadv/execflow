'use client'

/**
 * Case Workspace — first operational case view (read-only).
 *
 * Route: /cases/[caseId]
 * Entry: /queues → item with executionCaseId
 *
 * Architecture ref: Case Workspace specification (read-only MVP).
 */

import { useState, useCallback, useEffect } from 'react'
import { ExtractionReviewWorkspace } from '@/components/extraction/ExtractionReviewWorkspace'
import Link from 'next/link'
import { TriangleAlert, AlertCircle } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useSession } from '@/lib/hooks/use-session'
import { useCase } from '@/lib/hooks/use-case'
import { useCaseTimeline } from '@/lib/hooks/use-case-timeline'
import {
  useCaseDocuments,
  useRequestUpload,
  useCompleteUpload,
  useCasePieceDrafts,
} from '@/lib/hooks/use-case-documents'
import { downloadBlob, viewBlob } from '@/lib/api-client'
import {
  useCaseOpportunities,
  useReviewOpportunity,
  useDeferOpportunity,
  useOpportunityReviews,
  useGeneratePieceDraft,
} from '@/lib/hooks/use-case-opportunities'
import { useCaseDeadlines } from '@/lib/hooks/use-case-deadlines'
import { useQueryClient } from '@tanstack/react-query'
import { CrawlerSyncButton } from '@/components/case-workspace/CrawlerSyncButton'
import { AnalyzeAutosButton } from '@/components/case-workspace/AnalyzeAutosButton'
import { useDeadline } from '@/lib/hooks/use-deadline'
import {
  useCreateDeadline,
  useAcknowledgeDeadline,
  useCompleteDeadline,
  useDismissDeadline,
} from '@/lib/hooks/use-deadline-mutations'
import { useDeadlineHistory } from '@/lib/hooks/use-deadline-history'
import { useQueueProjections } from '@/lib/hooks/use-queue-projections'
import { useEngineRuns, useEvaluateEngine } from '@/lib/hooks/use-engine-runs'
import {
  useCaseSentenceSnapshots,
  useProposeSentenceSnapshot,
  useConfirmSentenceSnapshot,
  useSupersedeSentenceSnapshot,
  type SentenceSnapshotItem,
} from '@/lib/hooks/use-case-snapshots'
import { DashboardPageHeader } from '@/components/dashboard'
import { CaseTabBar, type CaseTabId } from '@/components/case-workspace/CaseTabBar'
import { CasePartiesAndSearch } from '@/components/case-workspace/CasePartiesAndSearch'
import { PieceEditorModal } from '@/components/case-workspace/PieceEditorModal'
import { PromptEditorModal, type GeneratePiecePayload } from '@/components/opportunities/PromptEditorModal'
import { EditCaseModal } from '@/components/modals/EditCaseModal'
import { borders, text } from '@/components/dashboard/surfaces'
import {
  EmptyState,
  ErrorState,
  ListCard,
  LoadingState,
  PriorityBadge,
  StatusBadge,
  Button,
} from '@/components/ui'
import {
  QUEUE_TYPE_LABELS,
  OPPORTUNITY_TYPE_LABELS,
} from '@/lib/operational/queue-display'
import {
  deadlineCardAccentClass,
  deadlineClassLabel,
} from '@/lib/operational/deadline-display'
import {
  documentStatusLabel,
  ocrStatusLabel,
} from '@/lib/operational/document-display'
import {
  timelineEventTypeLabel,
  timelineCategoryLabel,
  timelineVisibilityLabel,
  opportunityStatusLabel,
  engineTriggerLabel,
  engineStatusLabel,
  documentClassLabel,
} from '@/lib/operational/labels'
import {
  CrimeBreakdownForm,
  type CrimeBreakdownItem,
} from '@/components/case-workspace/CrimeBreakdownForm'

/* ─── Formatters ────────────────────────────────────────────────────────── */

function formatDate(iso: string | Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso))
}

function formatDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* ─── 4.6 Ícone por mimeType real (CaseDocumentItem.mimeType: string) ──── */
function docMimeIcon(mimeType: string): string {
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.startsWith('image/')) return '🖼️'
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return '🗎'
  if (mimeType.startsWith('text/')) return '📝'
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z'))
    return '📦'
  return '🗋'
}

/* ─── Case status chip — 4.3 ────────────────────────────────────────────── */
const CASE_STATUS_LABELS: Record<string, string> = {
  intake: 'Triagem',
  active: 'Ativo',
  suspended: 'Suspenso',
  closed: 'Encerrado',
  archived: 'Arquivado',
}

function caseStatusChipClass(status: string): string {
  if (status === 'active')
    return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (status === 'intake') return 'text-blue-700 bg-blue-50 border-blue-200'
  if (status === 'suspended')
    return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-slate-600 bg-slate-50 border-slate-100'
}

/* ─── 4.4 Priority accent (Trabalho tab) — numeric priority ─────────────── */
function workPriorityAccentClass(priority: number): string {
  if (priority === 0) return 'border-red-200 bg-red-50'
  if (priority === 1) return 'border-orange-200 bg-orange-50'
  if (priority === 2) return 'border-amber-200 bg-amber-50'
  return ''
}

/* ─── Fade-in wrapper — 4.11 ────────────────────────────────────────────── */
function FadeIn({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-[fadeIn_200ms_ease-out_both]">
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {children}
    </div>
  )
}

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function CaseWorkspacePage() {
  const params = useParams()
  const caseId = typeof params['caseId'] === 'string' ? params['caseId'] : ''
  const [activeTab, setActiveTab] = useState<CaseTabId>('timeline')
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [selectedDeadlineId, setSelectedDeadlineId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const tab = urlParams.get('tab') as CaseTabId
      if (tab) setActiveTab(tab)
    }
  }, [])
  
  // Claude Draft Modal State
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)

  // Edit Case Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''

  // Hooks — lazy per tab (unchanged)
  const caseQuery = useCase(orgId, caseId, session !== null && caseId !== '')
  const timelineQuery = useCaseTimeline(orgId, caseId, activeTab === 'timeline')
  const documentsQuery = useCaseDocuments(orgId, caseId, activeTab === 'documentos')
  const opportunitiesQuery = useCaseOpportunities(
    orgId,
    caseId,
    activeTab === 'oportunidades',
  )
  const deadlinesQuery = useCaseDeadlines(orgId, caseId, activeTab === 'prazos')
  const snapshotsQuery = useCaseSentenceSnapshots(orgId, caseId, activeTab === 'calculos')

  const proposeMutation = useProposeSentenceSnapshot(orgId, caseId)
  const confirmMutation = useConfirmSentenceSnapshot(orgId, caseId)
  const supersedeMutation = useSupersedeSentenceSnapshot(orgId, caseId)

  const reviewOpportunityMutation = useReviewOpportunity(orgId, caseId)
  const deferOpportunityMutation = useDeferOpportunity(orgId, caseId)
  const generateDraftMutation = useGeneratePieceDraft(orgId, caseId)

  const requestUploadMutation = useRequestUpload(orgId)
  const completeUploadMutation = useCompleteUpload(orgId, caseId)

  const createDeadlineMutation = useCreateDeadline(orgId, caseId)
  const acknowledgeDeadlineMutation = useAcknowledgeDeadline(orgId, selectedDeadlineId ?? '')
  const completeDeadlineMutation = useCompleteDeadline(orgId, selectedDeadlineId ?? '')
  const dismissDeadlineMutation = useDismissDeadline(orgId, selectedDeadlineId ?? '')

  const caseData = caseQuery.data?.data

  // 4.1 — breadcrumb
  const breadcrumb = 'Execuções'

  // 4.2 — header title
  const headerTitle =
    caseData?.clientSummary.displayName ??
    caseData?.clientSummary.fullName ??
    'Execução penal'

  // 4.3 — metadata chips (formerly flat string)
  const metaChips: { label: string; value: string }[] = []
  if (caseData !== undefined) {
    metaChips.push({ label: 'Ref', value: caseData.internalRef })
    if (caseData.executionProcessNumber !== null) {
      metaChips.push({ label: 'Processo', value: caseData.executionProcessNumber })
    } else {
      metaChips.push({ label: 'Processo', value: 'Pendente' })
    }
    if (caseData.courtName !== null) {
      metaChips.push({ label: 'Vara', value: caseData.courtName })
    }
    if (caseData.courtJurisdiction !== null) {
      metaChips.push({ label: 'Comarca', value: caseData.courtJurisdiction })
    }
    metaChips.push({ label: 'Aberto', value: formatDate(caseData.openedAt) })
  }

  return (
    <div>
      {sessionLoading ? (
        <LoadingState label="Carregando sessão…" />
      ) : session === null ? (
        <ErrorState message="Sessão não encontrada. Faça login novamente." />
      ) : caseId === '' ? (
        <ErrorState message="Identificador de caso inválido." />
      ) : (
        <>
          {caseQuery.isLoading ? (
            <LoadingState label="Carregando caso…" />
          ) : caseQuery.isError ? (
            <ErrorState
              message={caseQuery.error.message ?? 'Erro ao carregar caso.'}
              onRetry={() => { void caseQuery.refetch() }}
            />
          ) : (
            <>
              {/* 4.1 — Breadcrumb premium */}
              <div className="mb-5">
                <Link
                  href="/cases"
                  className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${text.muted} hover:text-slate-700 transition-colors`}
                >
                  ← {breadcrumb}
                </Link>
              </div>

              {/* 4.2 — Header title */}
              <DashboardPageHeader
                eyebrow="Execução penal"
                title={headerTitle}
                description={
                  caseData !== undefined ? (
                    <div className="flex flex-wrap items-center gap-3 mt-3">
                      {metaChips.map((chip, i) => (
                        <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-100 shadow-inner">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{chip.label}</span>
                          <span className="text-[12px] text-slate-700 font-medium">{chip.value}</span>
                        </div>
                      ))}
                      {caseData.monitoringStatus === 'sealed' && (
                        <Link
                          href="/settings/astrea-sigilosos"
                          className={[
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-md border shadow-inner transition-colors',
                            caseData.astreaSealedCredentialStatus === 'configured'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : caseData.astreaSealedCredentialStatus === 'possibly_expired'
                                ? 'bg-amber-50 border-amber-200 text-amber-700'
                                : 'bg-slate-100 border-slate-300 text-slate-700',
                          ].join(' ')}
                        >
                          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Segredo de justiça</span>
                          <span className="text-[12px] font-medium">
                            {caseData.astreaSealedCredentialStatus === 'configured'
                              ? 'Credencial OK'
                              : caseData.astreaSealedCredentialStatus === 'possibly_expired'
                                ? 'Verificar senha'
                                : 'Cadastrar no Astrea'}
                          </span>
                        </Link>
                      )}
                    </div>
                  ) : undefined
                }
                actions={
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setIsEditModalOpen(true)}>
                      Editar Caso
                    </Button>
                    <CrawlerSyncButton organizationId={orgId} caseId={caseId} />
                    <AnalyzeAutosButton organizationId={orgId} caseId={caseId} />
                  </div>
                }
              />

              {/* Edit Modal */}
              {caseData !== undefined && (
                <EditCaseModal
                  open={isEditModalOpen}
                  onClose={() => setIsEditModalOpen(false)}
                  caseData={caseData}
                />
              )}

              {/* 4.3 — Chips de metadados */}
              {caseData !== undefined && (
                <div className="mt-3 mb-5 flex flex-wrap items-center gap-2">
                  {/* Status chip semântico */}
                  <span
                    className={[
                      'inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.10em]',
                      caseStatusChipClass(caseData.status),
                    ].join(' ')}
                  >
                    {CASE_STATUS_LABELS[caseData.status] ?? caseData.status}
                  </span>
                  {/* Link para perfil do cliente */}
                  {caseData.clientSummary.id !== undefined && (
                    <Link
                      href={`/clients/${caseData.clientSummary.id}`}
                      className={`ml-auto text-[12px] ${text.faint} underline-offset-2 hover:underline transition-colors`}
                    >
                      Ver perfil do cliente
                    </Link>
                  )}
                </div>
              )}

              {/* Freshness banner — shown when autos are stale or missing */}
              {caseData?.documentFreshnessStatus === 'stale' && (
                <div className="mt-3 mb-1 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-red-800">Autos desatualizados — geração de peça bloqueada</p>
                    <p className="mt-0.5 text-[12px] text-red-700">
                      {caseData.pendingCriticalMovementType
                        ? `Movimentação crítica: ${caseData.pendingCriticalMovementType}.`
                        : 'Uma movimentação crítica foi recebida após os autos carregados.'}{' '}
                      Faça upload dos autos atuais na aba{' '}
                      <button
                        className="underline underline-offset-2 font-medium hover:text-red-900"
                        onClick={() => setActiveTab('documentos')}
                      >
                        Documentos
                      </button>{' '}
                      para desbloquear.
                    </p>
                  </div>
                </div>
              )}
              {caseData?.documentFreshnessStatus === 'unknown' && (
                <div className="mt-3 mb-1 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-amber-800">Nenhum autos carregado</p>
                    <p className="mt-0.5 text-[12px] text-amber-700">
                      As peças geradas pelo Claude não terão os autos como base. Faça upload na aba{' '}
                      <button
                        className="underline underline-offset-2 font-medium hover:text-amber-900"
                        onClick={() => setActiveTab('documentos')}
                      >
                        Documentos
                      </button>{' '}
                      para melhor qualidade.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab bar */}
              <CaseTabBar activeTab={activeTab} onTabChange={setActiveTab} />

              {/* Tab content — lazy loading mantido */}
              {activeTab === 'timeline' && (
                <FadeIn>
                  <TimelineTab
                    isLoading={timelineQuery.isLoading}
                    isError={timelineQuery.isError}
                    errorMessage={timelineQuery.error?.message}
                    onRetry={() => { void timelineQuery.refetch() }}
                    items={timelineQuery.data?.data ?? []}
                  />
                </FadeIn>
              )}

              {activeTab === 'documentos' && (
                <FadeIn>
                  <DocumentosTab
                    isLoading={documentsQuery.isLoading}
                    isError={documentsQuery.isError}
                    errorMessage={documentsQuery.error?.message}
                    onRetry={() => { void documentsQuery.refetch() }}
                    items={documentsQuery.data?.data ?? []}
                    organizationId={orgId}
                    caseId={caseId}
                    onRequestUpload={async (input) => {
                      return requestUploadMutation.mutateAsync(input)
                    }}
                    onCompleteUpload={async (input) => {
                      return completeUploadMutation.mutateAsync(input)
                    }}
                    isUploading={requestUploadMutation.isPending || completeUploadMutation.isPending}
                  />
                </FadeIn>
              )}

              {activeTab === 'oportunidades' && (
                <FadeIn>
                  <OportunidadesTab
                    isLoading={opportunitiesQuery.isLoading}
                    isError={opportunitiesQuery.isError}
                    errorMessage={opportunitiesQuery.error?.message}
                    onRetry={() => { void opportunitiesQuery.refetch() }}
                    items={opportunitiesQuery.data?.data ?? []}
                    organizationId={orgId}
                    onReview={async (opportunityId, input) => {
                      await reviewOpportunityMutation.mutateAsync({ opportunityId, input })
                    }}
                    onDefer={async (opportunityId, input) => {
                      await deferOpportunityMutation.mutateAsync({ opportunityId, input })
                    }}
                    isReviewing={reviewOpportunityMutation.isPending}
                    isDeferring={deferOpportunityMutation.isPending}
                    onGenerateDraft={(opportunityId, payload, onSuccessCb) => {
                      generateDraftMutation.mutate({ opportunityId, ...payload }, {
                        onSuccess: (res) => {
                          setActiveDraftId(res.data.id)
                          setIsEditorOpen(true)
                          if (onSuccessCb) onSuccessCb()
                        }
                      })
                    }}
                    isGeneratingDraft={generateDraftMutation.isPending}
                    isEditorOpen={isEditorOpen}
                    setIsEditorOpen={setIsEditorOpen}
                    activeDraftId={activeDraftId}
                    setActiveDraftId={setActiveDraftId}
                    documentFreshnessStatus={caseData?.documentFreshnessStatus}
                  />
                </FadeIn>
              )}

              {activeTab === 'prazos' && (
                <FadeIn>
                  <PrazosTab
                    isLoading={deadlinesQuery.isLoading}
                    isError={deadlinesQuery.isError}
                    errorMessage={deadlinesQuery.error?.message}
                    onRetry={() => { void deadlinesQuery.refetch() }}
                    items={deadlinesQuery.data?.data ?? []}
                    organizationId={orgId}
                    caseId={caseId}
                    selectedDeadlineId={selectedDeadlineId}
                    setSelectedDeadlineId={setSelectedDeadlineId}
                    documents={documentsQuery.data?.data ?? []}
                    onCreateDeadline={async (input) => {
                      await createDeadlineMutation.mutateAsync(input)
                    }}
                    onAcknowledgeDeadline={async () => {
                      await acknowledgeDeadlineMutation.mutateAsync()
                    }}
                    onCompleteDeadline={async (input) => {
                      await completeDeadlineMutation.mutateAsync(input)
                    }}
                    onDismissDeadline={async (input) => {
                      await dismissDeadlineMutation.mutateAsync(input)
                    }}
                    isCreating={createDeadlineMutation.isPending}
                    isAcknowledging={acknowledgeDeadlineMutation.isPending}
                    isCompleting={completeDeadlineMutation.isPending}
                    isDismissing={dismissDeadlineMutation.isPending}
                    onNavigateToDoc={(docId) => {
                      setSelectedDocId(docId)
                      setActiveTab('documentos')
                    }}
                  />
                </FadeIn>
              )}

              {activeTab === 'calculos' && (
                <FadeIn>
                  <CalculosTab
                    isLoading={snapshotsQuery.isLoading}
                    isError={snapshotsQuery.isError}
                    errorMessage={snapshotsQuery.error?.message}
                    onRetry={() => { void snapshotsQuery.refetch() }}
                    items={snapshotsQuery.data?.data ?? []}
                    onConfirm={(id) => confirmMutation.mutate(id)}
                    onPropose={(input) => proposeMutation.mutate(input)}
                    onSupersede={(id, input) => supersedeMutation.mutate({ snapshotId: id, input })}
                    isProposing={proposeMutation.isPending}
                    isConfirming={confirmMutation.isPending}
                    isSuperseding={supersedeMutation.isPending}
                  />
                </FadeIn>
              )}

              {activeTab === 'partes' && (
                <FadeIn>
                  <CasePartiesAndSearch caseId={caseId} />
                </FadeIn>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/* ─── Tab props type ────────────────────────────────────────────────────── */

type TabProps<T> = {
  isLoading: boolean
  isError: boolean
  errorMessage?: string
  onRetry: () => void
  items: T[]
}

/* ─── Tab Trabalho — 4.4 accent bar por prioridade ──────────────────────── */

function TrabalhoTab({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  items,
}: TabProps<import('@/lib/hooks/use-queue-projections').QueueProjectionItem>) {
  if (isLoading) return <LoadingState label="Carregando resumo…" />
  if (isError) {
    return (
      <ErrorState
        message={errorMessage ?? 'Erro ao carregar resumo.'}
        onRetry={onRetry}
      />
    )
  }
  if (items.length === 0) {
    return (
      <EmptyState
        variant="tab"
        title="Nenhum item pendente"
        description="Não há itens pendentes no resumo deste caso no momento."
      />
    )
  }
  return (
    <div className="space-y-2">
      <p className={`text-[12px] ${text.faint} mb-3`}>
        {items.length} {items.length === 1 ? 'item' : 'itens'} pendente
        {items.length === 1 ? '' : 's'}
      </p>
      <ul className="space-y-2" aria-label="Resumo de pendências">
        {items.map((item) => (
          <li key={item.id}>
            {/* 4.4 — accent bar por prioridade */}
            <ListCard variant="row" accentClassName={workPriorityAccentClass(item.priority)}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <PriorityBadge priority={item.priority} />
                  <span className={`text-[11px] ${text.faint} truncate`}>
                    {QUEUE_TYPE_LABELS[item.queueType] ?? item.queueType}
                  </span>
                </div>
                <p className={`text-[13px] font-medium ${text.secondary} truncate`}>
                  {item.displayTitle}
                </p>
                {item.slaDeadlineAt !== null && (
                  <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                    Prazo: {formatDate(item.slaDeadlineAt)}
                  </p>
                )}
              </div>
            </ListCard>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ─── Tab Timeline — 4.5 linha vertical conectada ───────────────────────── */

function TimelineTab({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  items,
}: TabProps<import('@/lib/hooks/use-case-timeline').TimelineEventItem>) {
  if (isLoading) return <LoadingState label="Carregando movimentações…" />
  if (isError) {
    return (
      <ErrorState
        message={errorMessage ?? 'Erro ao carregar movimentações.'}
        onRetry={onRetry}
      />
    )
  }
  if (items.length === 0) {
    return (
      <EmptyState
        variant="tab"
        title="Nenhuma movimentação registrada"
        description="As movimentações deste processo aparecerão aqui (mais recentes no topo)."
      />
    )
  }
  // Mais recentes no topo.
  const sorted = [...items].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )
  return (
    <ul className="space-y-0" aria-label="Movimentações">
      {sorted.map((event, index) => (
        <li key={event.id} className="flex gap-3">
          {/* 4.5 — linha vertical conectada */}
          <div className="flex flex-col items-center pt-3">
            <span
              className={`h-2 w-2 shrink-0 rounded-full border ${borders.default} bg-slate-50`}
              aria-hidden
            />
            {index < sorted.length - 1 && (
              <span className="mt-1 flex-1 w-[1px] bg-slate-50" aria-hidden />
            )}
          </div>
          {/* Conteúdo */}
          <div className="min-w-0 flex-1 pb-4">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <StatusBadge>{timelineCategoryLabel(event.eventCategory)}</StatusBadge>
              <span className={`text-[11px] ${text.faint}`}>{timelineVisibilityLabel(event.visibility)}</span>
              <span className={`text-[11px] ${text.faint} ml-auto tabular-nums shrink-0`}>
                {formatDateTime(event.occurredAt)}
              </span>
            </div>
            <p className={`text-[13px] ${text.secondary}`}>{event.summary}</p>
            <p className={`mt-0.5 text-[11px] ${text.faint}`}>{timelineEventTypeLabel(event.eventType)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ─── Tab Documentos — 4.6 ícone por mimeType real ──────────────────────── */

/* ─── Tab Documentos — 4.6 ícone por mimeType real ──────────────────────── */

type DocumentosTabProps = TabProps<import('@/lib/hooks/use-case-documents').CaseDocumentItem> & {
  organizationId: string
  caseId: string
  onRequestUpload: (input: any) => Promise<any>
  onCompleteUpload: (input: any) => Promise<any>
  isUploading: boolean
}

function DocumentosTab({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  items,
  organizationId,
  caseId,
  onRequestUpload,
  onCompleteUpload,
  isUploading: isMutatingUpload,
}: DocumentosTabProps) {
  const [reviewingExtractionDocId, setReviewingExtractionDocId] = useState<string | null>(null)
  const handleCloseReview = useCallback(() => setReviewingExtractionDocId(null), [])
  const handleSnapshotCreated = useCallback(() => setReviewingExtractionDocId(null), [])

  // Peças geradas pelo Claude (aparecem junto dos documentos).
  const pieceDraftsQuery = useCasePieceDrafts(organizationId, caseId, true)
  const pieces = pieceDraftsQuery.data?.data ?? []

  // Download/visualização (fetch com header de org → blob).
  const [busyId, setBusyId] = useState<string | null>(null)
  const handleDownloadDoc = async (doc: { id: string; fileName: string }) => {
    setBusyId(doc.id)
    try {
      await downloadBlob(`/api/v1/documents/${doc.id}/download?download=true`, {
        organizationId,
        fileName: doc.fileName,
      })
    } catch (e: any) {
      alert(`Falha ao baixar: ${e?.message ?? 'erro'}`)
    } finally {
      setBusyId(null)
    }
  }
  const handleViewDoc = async (doc: { id: string }) => {
    try {
      await viewBlob(`/api/v1/documents/${doc.id}/download`, { organizationId })
    } catch (e: any) {
      alert(`Falha ao abrir: ${e?.message ?? 'erro'}`)
    }
  }
  const handleDownloadPiece = async (p: { id: string }) => {
    setBusyId(p.id)
    try {
      await downloadBlob(`/api/v1/piece-drafts/${p.id}/export-docx`, {
        organizationId,
        fileName: `peca-${p.id.substring(0, 8)}.docx`,
      })
    } catch (e: any) {
      alert(`Falha ao baixar a peça: ${e?.message ?? 'erro'}`)
    } finally {
      setBusyId(null)
    }
  }

  // Upload States
  const [file, setFile] = useState<File | null>(null)
  const [docClass, setDocClass] = useState('Petição')
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'hashing' | 'requesting' | 'uploading' | 'completing' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0])
      setUploadStatus('idle')
      setUploadError(null)
    }
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    setUploadStatus('hashing')
    setUploadError(null)
    setUploadProgress(10)

    try {
      // 1. Calculate SHA-256
      const buffer = await file.arrayBuffer()
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const sha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
      
      setUploadStatus('requesting')
      setUploadProgress(30)

      // 2. Request presigned upload
      const reqRes = await onRequestUpload({
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        byteSize: file.size,
        checksumSha256: sha256,
        sourceChannel: 'intake_manual',
      })

      const { uploadUrl, uploadToken, headers } = reqRes.data

      setUploadStatus('uploading')
      setUploadProgress(60)

      // 3. Put blob to storage
      const putHeaders: Record<string, string> = {
        ...headers,
        'X-Upload-Token': uploadToken,
      }
      
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: putHeaders,
      })

      if (!uploadRes.ok) {
        throw new Error(`Falha ao enviar arquivo para o armazenamento (${uploadRes.status})`)
      }

      setUploadStatus('completing')
      setUploadProgress(85)

      // 4. Complete upload
      await onCompleteUpload({
        uploadToken,
        executionCaseId: caseId,
        documentClass: docClass,
        sensitivityLevel: 'standard',
      })

      setUploadStatus('success')
      setUploadProgress(100)
      setFile(null)
      // Automatically select the newly uploaded file if possible, or reset
      setTimeout(() => setUploadStatus('idle'), 3000)
    } catch (err: any) {
      console.error(err)
      setUploadStatus('error')
      setUploadError(err?.message || 'Ocorreu um erro durante o upload.')
    }
  }

  if (isLoading) return <LoadingState label="Carregando peças…" />
  if (isError) {
    return (
      <ErrorState
        message={errorMessage ?? 'Erro ao carregar peças.'}
        onRetry={onRetry}
      />
    )
  }

  return (
    <>
      {/* Extraction Review Workspace Modal */}
      {reviewingExtractionDocId && (
        <ExtractionReviewWorkspace
          organizationId={organizationId}
          documentId={reviewingExtractionDocId}
          caseId={caseId}
          onClose={handleCloseReview}
          onSnapshotCreated={handleSnapshotCreated}
        />
      )}

      <div className="space-y-4">
      {/* Upload + lista de documentos e peças */}
      <div className="space-y-4">
        {/* Upload Form Panel */}
        <div className="border border-slate-100 bg-slate-50 rounded-lg p-4 space-y-3">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 block">
            Adicionar Novo Documento (PDF)
          </span>
          <form onSubmit={handleUploadSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Classe Documental</label>
                <select
                  value={docClass}
                  onChange={(e) => setDocClass(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded p-1.5 text-[11px] focus:outline-none focus:border-blue-600"
                >
                  <option value="Petição">Petição</option>
                  <option value="Sentença">Sentença</option>
                  <option value="Decisão">Decisão</option>
                  <option value="Procuração">Procuração</option>
                  <option value="Certidão de Trabalho">Certidão de Trabalho</option>
                  <option value="Histórico Carcerário">Histórico Carcerário</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Arquivo PDF</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="w-full text-[11px] text-slate-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[11px] file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-600 cursor-pointer"
                />
              </div>
            </div>

            {/* Status alerts */}
            {uploadStatus === 'error' && (
              <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 p-2 rounded">
                Erro: {uploadError}
              </div>
            )}
            {uploadStatus === 'success' && (
              <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded">
                Documento enviado e associado com sucesso!
              </div>
            )}

            {uploadStatus !== 'idle' && uploadStatus !== 'success' && uploadStatus !== 'error' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>
                    {uploadStatus === 'hashing' && 'Calculando integridade (SHA-256)...'}
                    {uploadStatus === 'requesting' && 'Solicitando canal seguro...'}
                    {uploadStatus === 'uploading' && 'Enviando bytes do arquivo...'}
                    {uploadStatus === 'completing' && 'Registrando no caso...'}
                  </span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-slate-50 h-1.5 rounded overflow-hidden">
                  <div className="bg-blue-600 h-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            {file && uploadStatus === 'idle' && (
              <button
                type="submit"
                disabled={isMutatingUpload}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-600 disabled:bg-blue-800 text-white rounded text-[11px] font-medium transition cursor-pointer"
              >
                Iniciar Upload
              </button>
            )}
          </form>
        </div>

        {/* Peças geradas pelo Claude */}
        {pieces.length > 0 && (
          <div className="space-y-2">
            <p className={`text-[12px] font-semibold ${text.secondary}`}>Peças geradas pela IA</p>
            <ul className="space-y-2" aria-label="Peças geradas">
              {pieces.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 border border-violet-200 bg-violet-50 rounded-lg p-4"
                >
                  <span className="shrink-0 text-[18px] leading-none" aria-hidden="true">📝</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] font-medium ${text.secondary}`}>
                      Peça processual (Claude){p.finalizedAt ? ' — finalizada' : ' — rascunho'}
                    </p>
                    <div className={`mt-1 flex flex-wrap gap-x-3 text-[11px] ${text.faint}`}>
                      <span>Gerada {formatDate(p.createdAt)}</span>
                      {p.modelUsed && <span>{p.modelUsed}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownloadPiece(p)}
                    disabled={busyId === p.id}
                    className="shrink-0 inline-flex items-center gap-1.5 py-1.5 px-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded text-[11px] font-medium transition cursor-pointer"
                  >
                    {busyId === p.id ? 'Baixando…' : '📥 Baixar Word'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Documentos do caso */}
        <p className={`text-[12px] ${text.faint}`}>
          {items.length} {items.length === 1 ? 'documento' : 'documentos'}
        </p>

        {items.length === 0 ? (
          <EmptyState
            variant="tab"
            title="Nenhum documento"
            description="Autos, peças e demais documentos deste caso aparecerão aqui (mais recentes no topo)."
          />
        ) : (
          <ul className="space-y-2" aria-label="Documentos">
            {[...items]
              .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
              .map((doc) => {
                const needsExtractionReview = doc.status === 'extraction_review'
                const nome = doc.documentClass ? documentClassLabel(doc.documentClass) : doc.fileName
                return (
                  <li
                    key={doc.id}
                    className={`border rounded-lg p-4 ${needsExtractionReview ? 'border-amber-500/40 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 text-[18px] leading-none mt-0.5" aria-hidden="true">
                        {docMimeIcon(doc.mimeType)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{nome}</p>
                        <p className={`text-[11px] ${text.faint} truncate`}>{doc.fileName}</p>
                        <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] ${text.faint}`}>
                          <span>{documentStatusLabel(doc.status)}</span>
                          <span>{formatBytes(doc.byteSize)}</span>
                          <span>Enviado {formatDate(doc.uploadedAt)}</span>
                        </div>
                        {needsExtractionReview && (
                          <button
                            onClick={() => setReviewingExtractionDocId(doc.id)}
                            className="mt-2 text-[11px] font-semibold text-amber-700 hover:text-amber-800 underline underline-offset-2 cursor-pointer"
                          >
                            ⚡ Revisar extração →
                          </button>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col gap-1.5">
                        <button
                          onClick={() => handleViewDoc(doc)}
                          className="inline-flex items-center gap-1 py-1 px-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 rounded text-[11px] font-medium transition cursor-pointer"
                        >
                          👁 Visualizar
                        </button>
                        <button
                          onClick={() => handleDownloadDoc(doc)}
                          disabled={busyId === doc.id}
                          className="inline-flex items-center gap-1 py-1 px-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-[11px] font-medium transition cursor-pointer"
                        >
                          {busyId === doc.id ? '…' : '📥 Baixar'}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
          </ul>
        )}
      </div>
      </div>
    </>
  )
}

/* ─── Tab Oportunidades — 4.7 badge "Motor" se requiresReview ───────────── */

/* ─── Tab Oportunidades — 4.7 badge "Motor" se requiresReview ───────────── */

type OportunidadesTabProps = TabProps<import('@/lib/hooks/use-case-opportunities').CaseOpportunityItem> & {
  organizationId: string
  onReview: (opportunityId: string, input: any) => Promise<void>
  onDefer: (opportunityId: string, input: any) => Promise<void>
  isReviewing: boolean
  isDeferring: boolean
  isGeneratingDraft: boolean
  onGenerateDraft: (opportunityId: string, payload: GeneratePiecePayload, onSuccessCb?: () => void) => void
  isEditorOpen: boolean
  setIsEditorOpen: (open: boolean) => void
  activeDraftId: string | null
  setActiveDraftId: (id: string | null) => void
  documentFreshnessStatus?: string | null
}

function OportunidadesTab({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  items,
  organizationId,
  onReview,
  onDefer,
  isReviewing,
  isDeferring,
  onGenerateDraft,
  isGeneratingDraft,
  isEditorOpen,
  setIsEditorOpen,
  activeDraftId,
  setActiveDraftId,
  documentFreshnessStatus,
}: OportunidadesTabProps) {
  const isStale = documentFreshnessStatus === 'stale'
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const selectedOpp = items.find((opp) => opp.id === selectedOppId)
  const [promptEditorOpp, setPromptEditorOpp] = useState<any>(null)

  // Fetch reviews for selected opportunity
  const { data: reviewsData, isLoading: isLoadingReviews } = useOpportunityReviews(
    organizationId,
    selectedOppId ?? '',
    !!selectedOppId
  )

  const [actionForm, setActionForm] = useState<
    | 'qualified'
    | 'rejected'
    | 'changes_requested'
    | 'deferred'
    | 'escalated'
    | 'pursuing_started'
    | 'realized'
    | null
  >(null)

  const [explanation, setExplanation] = useState('')
  const [rejectionReasonCode, setRejectionReasonCode] = useState<
    | 'not_applicable'
    | 'data_insufficient'
    | 'timing_not_met'
    | 'prior_dismissal'
    | 'superseded'
    | 'other'
  >('not_applicable')
  const [deferredUntil, setDeferredUntil] = useState('')
  const [realizedPieceDraftId, setRealizedPieceDraftId] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  if (isLoading) return <LoadingState label="Carregando oportunidades…" />
  if (isError) {
    return (
      <ErrorState
        message={errorMessage ?? 'Erro ao carregar oportunidades.'}
        onRetry={onRetry}
      />
    )
  }
  if (items.length === 0) {
    return (
      <EmptyState
        variant="tab"
        title="Nenhuma oportunidade"
        description="Oportunidades detectadas para este caso aparecerão aqui."
      />
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (explanation.trim().length < 10) {
      setErrorMsg('A justificativa deve ter pelo menos 10 caracteres.')
      return
    }

    try {
      if (actionForm === 'deferred') {
        if (!deferredUntil) {
          setErrorMsg('Por favor, selecione uma data limite para o adiamento.')
          return
        }
        await onDefer(selectedOppId!, {
          deferredUntil: new Date(deferredUntil).toISOString(),
          explanation,
        })
      } else {
        const payload: any = {
          reviewAction: actionForm,
          explanation,
        }
        if (actionForm === 'rejected') {
          payload.rejectionReasonCode = rejectionReasonCode
        }
        if (actionForm === 'realized') {
          if (!realizedPieceDraftId.match(/^[0-9a-f-]{36}$/i)) {
            setErrorMsg('Por favor, insira um UUID válido para o rascunho de peça.')
            return
          }
          payload.realizedPieceDraftId = realizedPieceDraftId
        }
        await onReview(selectedOppId!, payload)
      }
      setSuccessMsg('Operação realizada com sucesso!')
      setActionForm(null)
      setExplanation('')
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Falha ao salvar revisão.')
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Left side: Opportunities List */}
      <div className={`${selectedOppId ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-2`}>
        <div className="flex justify-between items-center mb-3">
          <p className={`text-[12px] ${text.faint}`}>
            {items.length} {items.length === 1 ? 'oportunidade' : 'oportunidades'} detectada{items.length === 1 ? '' : 's'}
          </p>
          {selectedOppId && (
            <button
              onClick={() => {
                setSelectedOppId(null)
                setActionForm(null)
              }}
              className="text-[12px] text-slate-600 hover:text-slate-900 underline cursor-pointer"
            >
              Limpar seleção
            </button>
          )}
        </div>
        <ul className="space-y-2" aria-label="Oportunidades">
          {items.map((opp) => {
            const isSelected = opp.id === selectedOppId
            return (
              <li key={opp.id}>
                <div
                  onClick={() => {
                    setSelectedOppId(opp.id)
                    setActionForm(null)
                    setErrorMsg(null)
                    setSuccessMsg(null)
                  }}
                  className={`cursor-pointer transition-all border rounded-lg p-4 bg-slate-50 hover:bg-slate-50 ${
                    isSelected ? 'border-blue-600/80 bg-slate-50' : 'border-slate-100'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <StatusBadge>
                      {OPPORTUNITY_TYPE_LABELS[opp.opportunityType] ?? opp.opportunityType}
                    </StatusBadge>
                    {opp.requiresReview && (
                      <span className="inline-flex items-center rounded border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-blue-600">
                        Motor
                      </span>
                    )}
                    <span className="text-[11px] font-mono px-1.5 py-0.25 bg-slate-50 border border-slate-100 rounded text-slate-600">
                      {opp.status}
                    </span>
                    {opp.confidenceLevel !== null && (
                      <span className={`text-[11px] ${text.faint}`}>
                        Confiança: {opp.confidenceLevel}
                      </span>
                    )}
                    {opp.isBlocked && (
                      <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700">
                        Bloqueada
                      </span>
                    )}
                  </div>
                  <p className={`text-[13px] ${text.secondary}`}>{opp.summary}</p>
                  {opp.rationale !== null && (
                    <p className={`mt-1 text-[12px] ${text.faint} line-clamp-2`}>{opp.rationale}</p>
                  )}
                  {opp.windowEndAt !== null && (
                    <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                      Janela até {formatDate(opp.windowEndAt)}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Right side: Detailed View & Review form */}
      {selectedOpp && (
        <div className="lg:col-span-1 border border-slate-200 bg-slate-50 rounded-lg p-5 space-y-4 sticky top-6 animate-[fadeIn_200ms_ease-out]">
          <div className="flex justify-between items-start">
            <div>
              <span className={`text-[10px] uppercase font-bold tracking-wider ${text.faint}`}>
                Detalhe da Oportunidade
              </span>
              <h4 className="text-[14px] font-semibold text-slate-900 mt-0.5">
                {OPPORTUNITY_TYPE_LABELS[selectedOpp.opportunityType] ?? selectedOpp.opportunityType}
              </h4>
            </div>
            <button
              onClick={() => {
                setSelectedOppId(null)
                setActionForm(null)
              }}
              className="text-slate-500 hover:text-slate-900 text-[16px] cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="text-[12px] text-slate-700 space-y-2 border-t border-slate-100 pt-3">
            <div>
              <span className="font-semibold block text-slate-600">Resumo:</span>
              <p className="mt-0.5 text-[13px]">{selectedOpp.summary}</p>
            </div>
            {selectedOpp.rationale && (
              <div>
                <span className="font-semibold block text-slate-600">Raciocínio Técnico:</span>
                <p className="mt-0.5 whitespace-pre-wrap font-mono text-[11px] bg-slate-50 p-2 rounded border border-slate-100 max-h-[150px] overflow-y-auto">
                  {selectedOpp.rationale}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
              <div>
                <span className="text-slate-600 block text-[10px]">STATUS</span>
                <span className="text-slate-900 text-[11px]">{opportunityStatusLabel(selectedOpp.status)}</span>
              </div>
              <div>
                <span className="text-slate-600 block text-[10px]">DETECTADO EM</span>
                <span className="text-slate-900 text-[11px]">{formatDate(selectedOpp.detectedAt)}</span>
              </div>
            </div>
          </div>

          {/* Render Rich Metadata if available */}
          {(selectedOpp.blockingConditions?.length ?? 0) > 0 && (
            <div className="space-y-1 text-[11px] bg-amber-50 border border-amber-200 p-3 rounded">
              <span className="font-semibold text-amber-700 block">Condições de Bloqueio:</span>
              <ul className="list-disc pl-4 space-y-1 text-slate-700">
                {selectedOpp.blockingConditions?.map((cond, i) => (
                  <li key={i}>{cond.condition} ({cond.type})</li>
                ))}
              </ul>
            </div>
          )}

          {(selectedOpp.requiredDocuments?.length ?? 0) > 0 && (
            <div className="space-y-1 text-[11px] bg-blue-50 border border-blue-200 p-3 rounded">
              <span className="font-semibold text-blue-700 block">Documentos Necessários:</span>
              <ul className="list-disc pl-4 space-y-1 text-slate-700">
                {selectedOpp.requiredDocuments?.map((doc, i) => (
                  <li key={i}>{doc.required} — <span className="italic">{doc.reason}</span> ({doc.urgency})</li>
                ))}
              </ul>
            </div>
          )}

          {/* Action buttons or forms */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 block">
              Ações de Revisão Humana
            </span>

            {/* Success and Error messages */}
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] p-2.5 rounded">
                {errorMsg}
              </div>
            )}
            {successMsg && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] p-2.5 rounded">
                {successMsg}
              </div>
            )}

            {actionForm === null ? (
              <div className="flex flex-wrap gap-2">
                {/* suggested -> qualified, dismissed, deferred */}
                {selectedOpp.status === 'suggested' && (
                  <>
                    <button
                      onClick={() => setActionForm('qualified')}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Qualificar
                    </button>
                    <button
                      onClick={() => setActionForm('rejected')}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-50 text-red-700 border border-red-200 rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Descartar
                    </button>
                    <button
                      onClick={() => setActionForm('deferred')}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Adiar
                    </button>
                  </>
                )}

                {/* qualified -> pursuing, dismissed, deferred */}
                {selectedOpp.status === 'qualified' && (
                  <>
                    <button
                      onClick={() => setActionForm('pursuing_started')}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-600 text-white rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Iniciar Execução
                    </button>
                    <button
                      onClick={() => !isStale && setPromptEditorOpp(selectedOpp)}
                      disabled={isGeneratingDraft || isStale}
                      title={isStale ? 'Autos desatualizados — faça upload dos autos novos para desbloquear' : undefined}
                      className={[
                        'px-3 py-1.5 flex items-center gap-1 rounded text-[12px] font-medium transition',
                        isStale
                          ? 'bg-red-50 border border-red-200 text-red-700 cursor-not-allowed opacity-80'
                          : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-600 text-white shadow-[0_0_15px_rgba(124,58,237,0.3)] disabled:opacity-50 cursor-pointer',
                      ].join(' ')}
                    >
                      {isStale ? '🔒 Autos desatualizados' : `✨ ${isGeneratingDraft ? 'Redigindo...' : 'Redigir Peça com Claude'}`}
                    </button>
                    <button
                      onClick={() => setActionForm('rejected')}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-50 text-red-700 border border-red-200 rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Descartar
                    </button>
                    <button
                      onClick={() => setActionForm('deferred')}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Adiar
                    </button>
                  </>
                )}

                {/* pursuing -> realized, dismissed, deferred */}
                {selectedOpp.status === 'pursuing' && (
                  <>
                    <button
                      onClick={() => setActionForm('realized')}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Marcar como Realizado
                    </button>
                    <button
                      onClick={() => setActionForm('rejected')}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-50 text-red-700 border border-red-200 rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Descartar
                    </button>
                    <button
                      onClick={() => setActionForm('deferred')}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[12px] font-medium transition cursor-pointer"
                    >
                      Adiar
                    </button>
                  </>
                )}

                {/* terminal states */}
                {(selectedOpp.status === 'realized' ||
                  selectedOpp.status === 'dismissed' ||
                  selectedOpp.status === 'expired') && (
                  <div className="text-[12px] text-slate-600 italic">
                    Oportunidade em estado final ({selectedOpp.status}). Nenhuma ação adicional é permitida.
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3 bg-slate-50 border border-slate-100 p-3 rounded">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-semibold text-blue-600">
                    Ação: {actionForm === 'qualified' ? 'Qualificar' : actionForm === 'rejected' ? 'Descartar' : actionForm === 'deferred' ? 'Adiar' : actionForm === 'pursuing_started' ? 'Iniciar Execução' : actionForm === 'realized' ? 'Realizar' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setActionForm(null)
                      setErrorMsg(null)
                    }}
                    className="text-[10px] text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>

                {/* Conditional Fields */}
                {actionForm === 'rejected' && (
                  <div className="space-y-1">
                    <label className="block text-[11px] text-slate-600">Motivo do Descarte</label>
                    <select
                      value={rejectionReasonCode}
                      onChange={(e: any) => setRejectionReasonCode(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded p-1.5 text-[11px] focus:outline-none focus:border-blue-600"
                    >
                      <option value="not_applicable">Não aplicável</option>
                      <option value="data_insufficient">Dados insuficientes</option>
                      <option value="timing_not_met">Requisitos de tempo não atendidos</option>
                      <option value="prior_dismissal">Já descartado anteriormente</option>
                      <option value="superseded">Substituído por outro cálculo</option>
                      <option value="other">Outro motivo</option>
                    </select>
                  </div>
                )}

                {actionForm === 'deferred' && (
                  <div className="space-y-1">
                    <label className="block text-[11px] text-slate-600">Adiar até</label>
                    <input
                      type="datetime-local"
                      required
                      value={deferredUntil}
                      onChange={(e) => setDeferredUntil(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded p-1.5 text-[11px] focus:outline-none focus:border-blue-600"
                    />
                  </div>
                )}

                {actionForm === 'realized' && (
                  <div className="space-y-1">
                    <label className="block text-[11px] text-slate-600">Rascunho de Peça (UUID)</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                      value={realizedPieceDraftId}
                      onChange={(e) => setRealizedPieceDraftId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded p-1.5 text-[11px] font-mono focus:outline-none focus:border-blue-600"
                    />
                  </div>
                )}

                {/* Explanation */}
                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-600">Justificativa (Mínimo 10 caracteres)</label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Escreva a justificativa para esta ação..."
                    value={explanation}
                    onChange={(e) => setExplanation(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded p-1.5 text-[11px] focus:outline-none focus:border-blue-600"
                  />
                  <span className={`text-[10px] block text-right ${explanation.trim().length >= 10 ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {explanation.trim().length}/10 caracteres
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={isReviewing || isDeferring}
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-600 disabled:bg-blue-800 disabled:text-slate-600 text-white rounded text-[11px] font-medium transition cursor-pointer"
                >
                  {isReviewing || isDeferring ? 'Enviando...' : 'Confirmar Ação'}
                </button>
              </form>
            )}
          </div>

          {/* Revision history */}
          <div className="border-t border-slate-100 pt-4 space-y-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 block">
              Histórico de Revisões
            </span>
            {isLoadingReviews ? (
              <span className="text-[11px] text-slate-500 block">Carregando histórico...</span>
            ) : reviewsData?.data && reviewsData.data.length > 0 ? (
              <ul className="space-y-2.5 max-h-[200px] overflow-y-auto pr-1">
                {reviewsData.data.map((review) => (
                  <li key={review.id} className="text-[11px] border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                    <div className="flex justify-between items-center text-slate-600 font-mono text-[9px]">
                      <span>AÇÃO: {review.reviewAction.toUpperCase()}</span>
                      <span>{formatDate(review.reviewedAt)}</span>
                    </div>
                    <p className="text-slate-900 mt-0.5">{review.explanation}</p>
                    {review.rejectionReasonCode && (
                      <span className="text-[9.5px] text-red-700">Motivo do descarte: {review.rejectionReasonCode}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[11px] text-slate-500 italic block">Nenhuma revisão registrada.</span>
            )}
          </div>
        </div>
      )}

      {/* Modal Configurar Peça (Prompt) */}
      {promptEditorOpp && (
        <PromptEditorModal
          opportunityId={promptEditorOpp.id}
          opportunityType={promptEditorOpp.opportunityType}
          summary={promptEditorOpp.summary}
          organizationId={organizationId}
          onClose={() => setPromptEditorOpp(null)}
          onConfirm={(payload) => {
            onGenerateDraft(promptEditorOpp.id, payload, () => setPromptEditorOpp(null))
          }}
          isGenerating={isGeneratingDraft}
        />
      )}

      {/* Modal Redator Claude */}
      <PieceEditorModal
        isOpen={isEditorOpen}
        onClose={() => {
          setIsEditorOpen(false)
          setActiveDraftId(null)
        }}
        organizationId={organizationId}
        draftId={activeDraftId || null}
      />
    </div>
  )
}

/* ─── Tab Prazos — 4.8 border.strong se overdue ─────────────────────────── */

type PrazosTabProps = {
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  onRetry: () => void
  items: import('@/lib/hooks/use-case-deadlines').CaseDeadlineItem[]
  organizationId: string
  caseId: string
  selectedDeadlineId: string | null
  setSelectedDeadlineId: (id: string | null) => void
  documents: import('@/lib/hooks/use-case-documents').CaseDocumentItem[]
  onCreateDeadline: (input: any) => Promise<void>
  onAcknowledgeDeadline: () => Promise<void>
  onCompleteDeadline: (input: any) => Promise<void>
  onDismissDeadline: (input: any) => Promise<void>
  isCreating: boolean
  isAcknowledging: boolean
  isCompleting: boolean
  isDismissing: boolean
  onNavigateToDoc: (docId: string) => void
}

function PrazosTab({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  items,
  organizationId,
  caseId,
  selectedDeadlineId,
  setSelectedDeadlineId,
  documents,
  onCreateDeadline,
  onAcknowledgeDeadline,
  onCompleteDeadline,
  onDismissDeadline,
  isCreating,
  isAcknowledging,
  isCompleting,
  isDismissing,
  onNavigateToDoc,
}: PrazosTabProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all_pending')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Creation Form State
  const [newTitle, setNewTitle] = useState('')
  const [newClass, setNewClass] = useState('legal')
  const [newPriority, setNewPriority] = useState('normal')
  const [newDueAt, setNewDueAt] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSourceDocId, setNewSourceDocId] = useState('')

  // Action states for right pane
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [showDismissForm, setShowDismissForm] = useState(false)

  // Completion Form State
  const [compReason, setCompReason] = useState('')
  const [compEvidenceType, setCompEvidenceType] = useState<'document' | 'filing' | 'court_event' | 'note' | 'other'>('document')
  const [compEvidenceId, setCompEvidenceId] = useState('')

  // Dismissal Form State
  const [dismissReason, setDismissReason] = useState('')
  const [dismissReasonCode, setDismissReasonCode] = useState('completed_elsewhere')

  // Load details and history
  const { data: detailData, isLoading: isDetailLoading, refetch: refetchDetail } = useDeadline(
    organizationId,
    selectedDeadlineId ?? '',
    selectedDeadlineId !== null && selectedDeadlineId !== ''
  )
  const { data: historyData, isLoading: isHistoryLoading, refetch: refetchHistory } = useDeadlineHistory(
    organizationId,
    selectedDeadlineId ?? '',
    selectedDeadlineId !== null && selectedDeadlineId !== ''
  )

  const selectedDeadline = detailData?.data
  const historyList = historyData?.data ?? []

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchTerm.toLowerCase()))

    if (statusFilter === 'all_pending') {
      return matchesSearch && ['open', 'acknowledged', 'overdue'].includes(item.status)
    }
    if (statusFilter !== 'all') {
      return matchesSearch && item.status === statusFilter
    }
    return matchesSearch
  })

  // Show message utility
  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 5000)
  }

  // Handle Create Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim() || !newDueAt) {
      showFeedback('error', 'Título e Data Limite são obrigatórios.')
      return
    }

    try {
      // Local date conversion to ISO string with timezone offset
      const localDate = new Date(newDueAt)
      if (isNaN(localDate.getTime())) {
        showFeedback('error', 'Data limite inválida.')
        return
      }

      await onCreateDeadline({
        executionCaseId: caseId,
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        dueAt: localDate.toISOString(),
        deadlineClass: newClass,
        origin: 'manual',
        priority: newPriority,
        sourceDocumentId: newSourceDocId || undefined,
      })

      showFeedback('success', 'Prazo operacional criado com sucesso!')
      setShowCreateForm(false)
      setNewTitle('')
      setNewDescription('')
      setNewDueAt('')
      setNewSourceDocId('')
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao criar prazo.')
    }
  }

  // Handle Acknowledge
  const handleAcknowledge = async () => {
    try {
      await onAcknowledgeDeadline()
      showFeedback('success', 'Prazo reconhecido com sucesso.')
      void refetchDetail()
      void refetchHistory()
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao reconhecer prazo.')
    }
  }

  // Handle Complete Submit
  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!compReason.trim()) {
      showFeedback('error', 'Justificativa é obrigatória para conclusão.')
      return
    }

    try {
      await onCompleteDeadline({
        completionEvidenceType: compEvidenceType,
        completionEvidenceId: compEvidenceId || undefined,
        reason: compReason.trim(),
      })

      showFeedback('success', 'Prazo marcado como CONCLUÍDO.')
      setShowCompleteForm(false)
      setCompReason('')
      setCompEvidenceId('')
      void refetchDetail()
      void refetchHistory()
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao concluir prazo.')
    }
  }

  // Handle Dismiss Submit
  const handleDismissSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dismissReason.trim()) {
      showFeedback('error', 'Justificativa é obrigatória para descarte.')
      return
    }

    try {
      await onDismissDeadline({
        dismissedReason: dismissReason.trim(),
        dismissedReasonCode: selectedDeadline?.status === 'overdue' ? dismissReasonCode : undefined,
      })

      showFeedback('success', 'Prazo DESCARTADO.')
      setShowDismissForm(false)
      setDismissReason('')
      void refetchDetail()
      void refetchHistory()
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao descartar prazo.')
    }
  }

  if (isLoading) return <LoadingState label="Carregando prazos…" />
  if (isError) {
    return (
      <ErrorState
        message={errorMessage ?? 'Erro ao carregar prazos.'}
        onRetry={onRetry}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left panel: List */}
      <div className="lg:col-span-2 space-y-4">
        {/* Controls Header */}
        <div className="bg-white border border-slate-200/80 rounded-lg p-3 space-y-2">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Filtro de Prazos</h3>
            <button
              onClick={() => {
                setShowCreateForm(!showCreateForm)
                setSelectedDeadlineId(null)
              }}
              className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-900 font-medium py-1 px-2.5 rounded border border-slate-300/60 transition-colors"
            >
              {showCreateForm ? 'Voltar para Lista' : '+ Criar Prazo'}
            </button>
          </div>

          {!showCreateForm && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              <input
                type="text"
                placeholder="Buscar por título..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full text-[11px] bg-slate-50 border border-slate-200 text-slate-900 rounded px-2 py-1 focus:outline-none focus:border-slate-300 transition-colors"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full text-[11px] bg-slate-50 border border-slate-200 text-slate-600 rounded px-2 py-1 focus:outline-none focus:border-slate-300 transition-colors"
              >
                <option value="all_pending">Pendentes (Em aberto/Atraso)</option>
                <option value="all">Todos os Status</option>
                <option value="open">Em Aberto (Open)</option>
                <option value="acknowledged">Reconhecido</option>
                <option value="overdue">Atrasado (Overdue)</option>
                <option value="completed">Concluído</option>
                <option value="dismissed">Descartado</option>
              </select>
            </div>
          )}
        </div>

        {/* Global Feedback Banner */}
        {feedback && (
          <div
            className={`p-2.5 rounded text-xs border ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* Create Deadline Form */}
        {showCreateForm ? (
          <form onSubmit={handleCreateSubmit} className="bg-white backdrop-blur-sm border border-slate-100 rounded-xl p-6 space-y-5 shadow-lg">
            <h4 className="text-[11px] font-semibold text-slate-600 uppercase tracking-[0.1em] mb-4">Novo Prazo Operacional</h4>

            <div className="space-y-1.5">
              <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.05em] text-slate-600">Título *</label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex: Manifestação sobre cálculo do Ministério Público"
                className="w-full rounded-lg border border-slate-200 bg-white shadow-inner px-4 py-2.5 text-[14px] text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-500 focus:border-blue-600/50 focus:ring-2 focus:ring-blue-600/20 focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.05em] text-slate-600">Classe *</label>
                <select
                  value={newClass}
                  onChange={(e) => setNewClass(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white shadow-inner px-4 py-2.5 text-[14px] text-slate-900 outline-none transition-all duration-200 focus:border-blue-600/50 focus:ring-2 focus:ring-blue-600/20 focus:bg-white [&>option]:bg-white [&>option]:text-slate-900"
                >
                  <option value="legal">Legal / Judicial</option>
                  <option value="benefit">Benefício / Lapso</option>
                  <option value="disciplinary">Disciplinar / PAD</option>
                  <option value="calculation">Cálculo Penal</option>
                  <option value="internal">SLA Interno</option>
                  <option value="recurring">Recorrente</option>
                  <option value="sla">SLA Geral</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.05em] text-slate-600">Prioridade *</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white shadow-inner px-4 py-2.5 text-[14px] text-slate-900 outline-none transition-all duration-200 focus:border-blue-600/50 focus:ring-2 focus:ring-blue-600/20 focus:bg-white [&>option]:bg-white [&>option]:text-slate-900"
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.05em] text-slate-600">Data Limite (Legal) *</label>
              <input
                type="datetime-local"
                required
                value={newDueAt}
                onChange={(e) => setNewDueAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white shadow-inner px-4 py-2.5 text-[14px] text-slate-900 outline-none transition-all duration-200 focus:border-blue-600/50 focus:ring-2 focus:ring-blue-600/20 focus:bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.05em] text-slate-600">Documento Vinculado</label>
              <select
                value={newSourceDocId}
                onChange={(e) => setNewSourceDocId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white shadow-inner px-4 py-2.5 text-[14px] text-slate-900 outline-none transition-all duration-200 focus:border-blue-600/50 focus:ring-2 focus:ring-blue-600/20 focus:bg-white [&>option]:bg-white [&>option]:text-slate-900"
              >
                <option value="">Nenhum documento</option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.documentClass} - {doc.fileName} ({formatDate(doc.uploadedAt)})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.05em] text-slate-600">Descrição / Observações</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Detalhes sobre a base legal, observações específicas..."
                rows={3}
                className="w-full rounded-lg border border-slate-200 bg-white shadow-inner px-4 py-2.5 text-[14px] text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-500 focus:border-blue-600/50 focus:ring-2 focus:ring-blue-600/20 focus:bg-white"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="text-[13px] text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg transition-colors border border-transparent hover:border-slate-200 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="text-[13px] bg-blue-600 hover:bg-blue-600 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_15px_rgba(79,70,229,0.3)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_20px_rgba(79,70,229,0.5)] transition-all duration-200"
              >
                {isCreating ? 'Salvando...' : 'Salvar Prazo'}
              </button>
            </div>
          </form>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            variant="tab"
            title="Nenhum prazo encontrado"
            description="Tente alterar os filtros ou crie um novo prazo manual."
          />
        ) : (
          <ul className="space-y-2 max-h-[600px] overflow-y-auto pr-1" aria-label="Prazos">
            {filteredItems.map((deadline) => {
              const accent = deadlineCardAccentClass(deadline.status, deadline.priority)
              const isSelected = deadline.id === selectedDeadlineId
              return (
                <li key={deadline.id}>
                  <div
                    onClick={() => {
                      setSelectedDeadlineId(deadline.id)
                      setShowCompleteForm(false)
                      setShowDismissForm(false)
                    }}
                    className={`block cursor-pointer border rounded-lg p-3 transition-all ${
                      isSelected
                        ? 'bg-slate-100 border-slate-300 shadow-md shadow-black/30'
                        : `bg-slate-50/20 border-slate-200/80 hover:bg-white hover:border-slate-300/60`
                    } ${accent}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <StatusBadge variant="deadline" status={deadline.status} />
                      <PriorityBadge variant="deadline" priority={deadline.priority} />
                      <span className={`text-[10px] ${text.faint}`}>
                        {deadlineClassLabel(deadline.deadlineClass)}
                      </span>
                      {deadline.isBlocked && (
                        <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-700">
                          Bloqueado
                        </span>
                      )}
                    </div>
                    <p className={`text-[13px] font-medium ${isSelected ? 'text-slate-900' : text.secondary}`}>
                      {deadline.title}
                    </p>
                    <div className="flex justify-between items-center mt-1.5">
                      <p className={`text-[11px] ${text.faint} tabular-nums`}>
                        Limite: {formatDate(deadline.dueAt)}
                      </p>
                      {deadline.status === 'overdue' && (
                        <span className="text-[9.5px] font-bold text-red-500 uppercase tracking-wide animate-pulse">
                          Atrasado
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Right panel: Details and History */}
      <div className="lg:col-span-3">
        {selectedDeadlineId && selectedDeadline ? (
          <div className="bg-white border border-slate-200/80 rounded-lg p-4 space-y-5 animate-[fadeIn_150ms_ease-out]">
            {isDetailLoading ? (
              <LoadingState label="Carregando detalhes do prazo..." />
            ) : (
              <>
                {/* Header */}
                <div className="border-b border-slate-200 pb-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <StatusBadge variant="deadline" status={selectedDeadline.status} />
                    <PriorityBadge variant="deadline" priority={selectedDeadline.priority} />
                    <span className="text-[11px] text-slate-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                      {deadlineClassLabel(selectedDeadline.deadlineClass)}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">{selectedDeadline.title}</h3>
                  {selectedDeadline.description && (
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed bg-slate-50 p-2 rounded border border-slate-200">
                      {selectedDeadline.description}
                    </p>
                  )}
                </div>

                {/* Metadata details */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200/40">
                    <span className="text-[10px] text-slate-500 block uppercase font-mono">Data Limite (Legal)</span>
                    <span className="text-slate-700 font-mono font-medium">{formatDate(selectedDeadline.dueAt)}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200/40">
                    <span className="text-[10px] text-slate-500 block uppercase font-mono">Origem</span>
                    <span className="text-slate-700 capitalize">{selectedDeadline.origin}</span>
                  </div>
                  {selectedDeadline.legalBasis && (
                    <div className="col-span-2 bg-slate-50 p-2.5 rounded border border-slate-200/40">
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Fundamentação Legal</span>
                      <span className="text-slate-700 italic">{selectedDeadline.legalBasis}</span>
                    </div>
                  )}

                  {/* Linked Document link */}
                  {selectedDeadline.sourceDocumentId && (
                    <div className="col-span-2 bg-blue-50 border border-blue-200 p-2.5 rounded flex justify-between items-center">
                      <div>
                        <span className="text-[10px] text-blue-700 block uppercase font-mono">Documento de Origem</span>
                        <span className="text-slate-700 text-[11px] truncate max-w-[250px] inline-block">
                          {documents.find((d) => d.id === selectedDeadline.sourceDocumentId)?.fileName || 'Ver arquivo associado'}
                        </span>
                      </div>
                      <button
                        onClick={() => onNavigateToDoc(selectedDeadline.sourceDocumentId!)}
                        className="text-[11px] bg-blue-100 hover:bg-blue-800 text-blue-700 px-2.5 py-1 rounded border border-blue-200 transition-colors"
                      >
                        Visualizar
                      </button>
                    </div>
                  )}
                </div>

                {/* Terminal states details */}
                {selectedDeadline.status === 'completed' && (
                  <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Prazo Cumprido
                    </div>
                    {selectedDeadline.completedAt && (
                      <p className="text-slate-600 text-[11px]">
                        Concluído em <span className="text-slate-700 font-mono">{formatDateTime(selectedDeadline.completedAt)}</span>
                      </p>
                    )}
                    {selectedDeadline.completionEvidenceType && (
                      <div className="mt-1 pt-1.5 border-t border-emerald-200 flex justify-between items-center text-[11px]">
                        <div>
                          <span className="text-slate-500">Evidência:</span>{' '}
                          <span className="text-slate-700 font-mono capitalize">{selectedDeadline.completionEvidenceType}</span>
                        </div>
                        {['document', 'filing'].includes(selectedDeadline.completionEvidenceType) && selectedDeadline.completionEvidenceId && (
                          <button
                            onClick={() => onNavigateToDoc(selectedDeadline.completionEvidenceId!)}
                            className="text-[10px] bg-emerald-100 hover:bg-emerald-800/50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200"
                          >
                            Visualizar Documento
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedDeadline.status === 'dismissed' && (
                  <div className="bg-slate-100 border border-slate-300/30 p-3 rounded-lg text-xs space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-600 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      Prazo Descartado / Não Aplicável
                    </div>
                    {selectedDeadline.dismissedAt && (
                      <p className="text-slate-500 text-[11px]">
                        Descartado em <span className="text-slate-600 font-mono">{formatDateTime(selectedDeadline.dismissedAt)}</span>
                      </p>
                    )}
                    {selectedDeadline.dismissedReason && (
                      <p className="text-slate-700 mt-1 italic">
                        &ldquo;{selectedDeadline.dismissedReason}&rdquo;
                      </p>
                    )}
                    {selectedDeadline.dismissedReasonCode && (
                      <p className="text-[10px] text-slate-500">
                        Motivo: <span className="font-mono bg-slate-50 px-1 py-0.5 rounded border border-slate-200">{selectedDeadline.dismissedReasonCode}</span>
                      </p>
                    )}
                  </div>
                )}

                {/* Interactive Action Buttons */}
                {!['completed', 'dismissed'].includes(selectedDeadline.status) && (
                  <div className="border-t border-slate-200/60 pt-4 space-y-3">
                    <div className="flex gap-2">
                      {['open', 'overdue'].includes(selectedDeadline.status) && !selectedDeadline.acknowledgedAt && (
                        <button
                          onClick={handleAcknowledge}
                          disabled={isAcknowledging}
                          className="flex-1 text-xs bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-900 font-medium py-2 px-3 rounded border border-slate-300/60 transition-colors"
                        >
                          {isAcknowledging ? 'Processando...' : 'Reconhecer Prazo'}
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setShowCompleteForm(!showCompleteForm)
                          setShowDismissForm(false)
                        }}
                        className="flex-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white font-medium py-2 px-3 rounded border border-emerald-600/30 transition-colors"
                      >
                        Concluir Prazo
                      </button>

                      <button
                        onClick={() => {
                          setShowDismissForm(!showDismissForm)
                          setShowCompleteForm(false)
                        }}
                        className="flex-1 text-xs bg-slate-50 hover:bg-white text-slate-600 hover:text-slate-700 font-medium py-2 px-3 rounded border border-slate-200 transition-colors"
                      >
                        Descartar
                      </button>
                    </div>

                    {/* Complete Form View */}
                    {showCompleteForm && (
                      <form onSubmit={handleCompleteSubmit} className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-3 animate-[slideDown_150ms_ease-out]">
                        <h4 className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Conclusão de Prazo</h4>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-600 block font-medium">Justificativa *</label>
                          <textarea
                            required
                            rows={2}
                            value={compReason}
                            onChange={(e) => setCompReason(e.target.value)}
                            placeholder="Descreva o ato realizado para conclusão do prazo..."
                            className="w-full text-[11px] bg-slate-50 border border-slate-200 text-slate-900 rounded px-2.5 py-1.5 focus:outline-none focus:border-slate-300"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-600 block font-medium">Tipo de Evidência</label>
                            <select
                              value={compEvidenceType}
                              onChange={(e) => {
                                setCompEvidenceType(e.target.value as any)
                                setCompEvidenceId('')
                              }}
                              className="w-full text-[10px] bg-slate-50 border border-slate-200 text-slate-900 rounded px-2 py-1 focus:outline-none"
                            >
                              <option value="document">Documento do Caso</option>
                              <option value="filing">Protocolo / Petição</option>
                              <option value="court_event">Evento Judicial</option>
                              <option value="note">Anotação Operacional</option>
                              <option value="other">Outro</option>
                            </select>
                          </div>

                          {['document', 'filing'].includes(compEvidenceType) && (
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-600 block font-medium">Selecionar Documento</label>
                              <select
                                value={compEvidenceId}
                                onChange={(e) => setCompEvidenceId(e.target.value)}
                                className="w-full text-[10px] bg-slate-50 border border-slate-200 text-slate-700 rounded px-2 py-1 focus:outline-none"
                              >
                                <option value="">Sem vínculo físico</option>
                                {documents.map((doc) => (
                                  <option key={doc.id} value={doc.id}>
                                    {doc.fileName}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end gap-2 pt-1 border-t border-emerald-200">
                          <button
                            type="button"
                            onClick={() => setShowCompleteForm(false)}
                            className="text-[10px] text-slate-600 hover:text-slate-900 px-2 py-1 rounded"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            disabled={isCompleting}
                            className="text-[10px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-3.5 py-1.5 rounded transition-colors"
                          >
                            {isCompleting ? 'Salvando...' : 'Confirmar Cumprimento'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Dismiss Form View */}
                    {showDismissForm && (
                      <form onSubmit={handleDismissSubmit} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3 animate-[slideDown_150ms_ease-out]">
                        <h4 className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Descarte de Prazo</h4>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-600 block font-medium">Justificativa *</label>
                          <textarea
                            required
                            rows={2}
                            value={dismissReason}
                            onChange={(e) => setDismissReason(e.target.value)}
                            placeholder="Motivo pelo qual este prazo está sendo arquivado/descartado..."
                            className="w-full text-[11px] bg-slate-50 border border-slate-200 text-slate-900 rounded px-2.5 py-1.5 focus:outline-none focus:border-slate-300"
                          />
                        </div>

                        {selectedDeadline.status === 'overdue' && (
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-600 block font-medium">Motivo (Obrigatório p/ Atraso)</label>
                            <select
                              value={dismissReasonCode}
                              onChange={(e) => setDismissReasonCode(e.target.value)}
                              className="w-full text-[10px] bg-slate-50 border border-slate-200 text-slate-900 rounded px-2 py-1 focus:outline-none"
                            >
                              <option value="completed_elsewhere">Cumprido fora do sistema</option>
                              <option value="superseded">Substituído por novo cálculo</option>
                              <option value="not_applicable">Não aplicável a este caso</option>
                              <option value="court_extension">Prorrogação concedida</option>
                              <option value="client_withdrawal">Desistência do cliente</option>
                              <option value="other">Outro motivo</option>
                            </select>
                          </div>
                        )}

                        <div className="flex justify-end gap-2 pt-1 border-t border-slate-200">
                          <button
                            type="button"
                            onClick={() => setShowDismissForm(false)}
                            className="text-[10px] text-slate-600 hover:text-slate-900 px-2 py-1 rounded"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            disabled={isDismissing}
                            className="text-[10px] bg-red-100 hover:bg-red-800 disabled:opacity-50 text-white font-medium px-3.5 py-1.5 rounded transition-colors"
                          >
                            {isDismissing ? 'Processando...' : 'Confirmar Descarte'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* History Log Panel */}
                <div className="border-t border-slate-200/80 pt-4 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Histórico de Alterações</h4>
                  {isHistoryLoading ? (
                    <LoadingState label="Carregando trilha auditável..." />
                  ) : historyList.length === 0 ? (
                    <span className="text-[11px] text-slate-500 italic block">Nenhum evento registrado no histórico.</span>
                  ) : (
                    <ul className="space-y-3 font-mono text-[10px]">
                      {historyList.map((hist) => {
                        let actionLabel = hist.changeType.toUpperCase()
                        if (hist.changeType === 'completed') actionLabel = 'CUMPRIDO'
                        if (hist.changeType === 'dismissed') actionLabel = 'DESCARTADO'
                        if (hist.changeType === 'acknowledged') actionLabel = 'RECONHECIDO'
                        if (hist.changeType === 'created') actionLabel = 'CRIADO'

                        return (
                          <li key={hist.id} className="border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                            <div className="flex justify-between text-slate-500 text-[9px] mb-0.5">
                              <span className="font-bold text-slate-600">AÇÃO: {actionLabel}</span>
                              <span>{formatDateTime(hist.changedAt)}</span>
                            </div>
                            <div className="text-slate-700">
                              <span>Por: </span>
                              <span className="text-slate-900">{hist.changedByActorId} ({hist.changedByActorType})</span>
                            </div>
                            {hist.reason && (
                              <p className="text-slate-600 mt-1 italic bg-slate-50 p-1.5 rounded border border-slate-200">
                                Justificativa: &ldquo;{hist.reason}&rdquo;
                              </p>
                            )}

                            {/* Completion Evidence in History */}
                            {hist.changeType === 'completed' && hist.newValue && (
                              <div className="mt-1 text-slate-500 text-[9px] flex justify-between items-center">
                                <span>
                                  Evidência: {(hist.newValue as any).completionEvidenceType || 'manual'}
                                </span>
                                {(hist.newValue as any).completionEvidenceId && (
                                  <button
                                    onClick={() => onNavigateToDoc((hist.newValue as any).completionEvidenceId)}
                                    className="text-[9px] text-blue-700 hover:text-blue-700 font-bold"
                                  >
                                    Ver documento
                                  </button>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200/40 rounded-lg p-8 text-center text-slate-500 text-xs">
            Selecione um prazo da listagem à esquerda para visualizar seus detalhes, executar ações operacionais e auditar o histórico de alterações.
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ─── Tab Motor — 4.9 badge "Replay" se isReplay ────────────────────────── */

type MotorTabProps = TabProps<import('@/lib/hooks/use-engine-runs').EngineRunListItem> & {
  onEvaluate: () => void
  isEvaluating: boolean
}

function MotorTab({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  items,
  onEvaluate,
  isEvaluating,
}: MotorTabProps) {
  if (isLoading) return <LoadingState label="Carregando avaliações do motor…" />
  if (isError) {
    return (
      <ErrorState
        message={errorMessage ?? 'Erro ao carregar avaliações do motor.'}
        onRetry={onRetry}
      />
    )
  }
  if (items.length === 0) {
    return (
      <EmptyState
        variant="tab"
        title="Nenhuma avaliação registada"
        description="Avaliações do motor para este caso aparecerão aqui."
      />
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className={`text-[12px] ${text.faint}`}>
          {items.length === 0 ? 'Nenhuma avaliação registrada' : 'Histórico de execuções do motor'}
        </p>
        <button
          onClick={onEvaluate}
          disabled={isEvaluating}
          className="text-[11px] bg-blue-600 hover:bg-blue-600 disabled:opacity-50 text-white font-medium py-1.5 px-3 rounded transition-colors"
        >
          {isEvaluating ? 'Avaliando...' : '▶ Rodar Motor'}
        </button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Avaliações do motor">
          {items.map((run) => (
        <li key={run.id}>
          <ListCard variant="static">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <StatusBadge>{engineTriggerLabel(run.trigger)}</StatusBadge>
              {/* 4.9 — badge "Replay" quando isReplay === true (campo tipado) */}
              {run.isReplay && (
                <span className="inline-flex items-center rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600">
                  Replay
                </span>
              )}
              <span className={`text-[11px] ${text.faint}`}>{engineStatusLabel(run.status)}</span>
              {run.uncertaintyLevel !== null && (
                <span className={`text-[11px] ${text.faint}`}>
                  Incerteza: {run.uncertaintyLevel}
                </span>
              )}
            </div>
            {run.evaluatedAt !== null && (
              <p className={`text-[11px] ${text.faint} tabular-nums`}>
                Avaliado em {formatDateTime(run.evaluatedAt)}
              </p>
            )}
            {run.opportunitiesCreated !== null &&
              Array.isArray(run.opportunitiesCreated) && (
                <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                  Oportunidades criadas: {run.opportunitiesCreated.length}
                </p>
              )}
            {run.blockingCodes !== null &&
              Array.isArray(run.blockingCodes) &&
              run.blockingCodes.length > 0 && (
                <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                  Bloqueios: {run.blockingCodes.join(', ')}
                </p>
              )}
          </ListCard>
        </li>
      ))}
    </ul>
    )}
  </div>
  )
}

/* ─── Tab Cálculos Penais (Fase 4A) ──────────────────────────────────────── */

type ProposeSentenceSnapshotInput = {
  effectiveAt: string
  totalSentenceDays: number
  servedDays: number
  remissionDays: number
  detractionDays: number
  calculationMethod: string
  crimesBreakdown?: any[]
  isGenericRecidivist?: boolean
}

type SupersedeSentenceSnapshotInput = ProposeSentenceSnapshotInput & {
  reason: string
}

type CalculosTabProps = {
  isLoading: boolean
  isError: boolean
  errorMessage?: string
  onRetry: () => void
  items: SentenceSnapshotItem[]
  onConfirm: (snapshotId: string) => void
  onPropose: (input: ProposeSentenceSnapshotInput) => void
  onSupersede: (snapshotId: string, input: SupersedeSentenceSnapshotInput) => void
  isProposing: boolean
  isConfirming: boolean
  isSuperseding: boolean
}

function CalculosTab({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  items,
  onConfirm,
  onPropose,
  onSupersede,
  isProposing,
  isConfirming,
  isSuperseding,
}: CalculosTabProps) {
  const [showForm, setShowForm] = useState(false)
  const [supersedeTarget, setSupersedeTarget] = useState<SentenceSnapshotItem | null>(null)

  // Form State
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().substring(0, 16))
  const [totalSentenceDays, setTotalSentenceDays] = useState(365 * 5) // Default 5 years
  const [servedDays, setServedDays] = useState(0)
  const [remissionDays, setRemissionDays] = useState(0)
  const [detractionDays, setDetractionDays] = useState(0)
  const [calculationMethod, setCalculationMethod] = useState('Unificação / Liquidação manual')
  const [reason, setReason] = useState('')
  const [crimesBreakdown, setCrimesBreakdown] = useState<CrimeBreakdownItem[]>([])
  const [isGenericRecidivist, setIsGenericRecidivist] = useState(false)

  const activeConfirmed = items.find((x) => x.status === 'confirmed')
  const proposedDrafts = items.filter((x) => x.status === 'proposed')
  const historical = items.filter((x) => x.status === 'superseded')

  const handleStartSupersede = (snap: SentenceSnapshotItem) => {
    setSupersedeTarget(snap)
    setEffectiveAt(new Date(snap.effectiveAt).toISOString().substring(0, 16))
    setTotalSentenceDays(snap.totalSentenceDays)
    setServedDays(snap.servedDays)
    setRemissionDays(snap.remissionDays)
    setDetractionDays(snap.detractionDays)
    setCalculationMethod(snap.calculationMethod || '')
    setReason('')
    setShowForm(true)
  }

  const handleStartProposeNew = () => {
    setSupersedeTarget(null)
    setEffectiveAt(new Date().toISOString().substring(0, 16))
    setTotalSentenceDays(365 * 5)
    setServedDays(0)
    setRemissionDays(0)
    setDetractionDays(0)
    setCalculationMethod('Unificação / Liquidação manual')
    setReason('')
    setCrimesBreakdown([])
    setIsGenericRecidivist(false)
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      effectiveAt: new Date(effectiveAt).toISOString(),
      totalSentenceDays: Number(totalSentenceDays),
      servedDays: Number(servedDays),
      remissionDays: Number(remissionDays),
      detractionDays: Number(detractionDays),
      calculationMethod: calculationMethod.trim(),
      crimesBreakdown: crimesBreakdown.length > 0 ? crimesBreakdown : undefined,
      isGenericRecidivist,
    }

    if (supersedeTarget !== null) {
      onSupersede(supersedeTarget.id, {
        ...payload,
        reason: reason.trim(),
      })
    } else {
      onPropose(payload)
    }

    setShowForm(false)
  }

  if (isLoading) return <LoadingState label="Carregando cálculos penais…" />
  if (isError) {
    return (
      <ErrorState
        message={errorMessage ?? 'Erro ao carregar cálculos penais.'}
        onRetry={onRetry}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className={`text-[14px] font-semibold ${text.primary}`}>
          Histórico de Cálculos de Sentença
        </h3>
        {!showForm && (
          <button
            onClick={handleStartProposeNew}
            className="rounded bg-slate-100 hover:bg-slate-200 text-slate-900 px-3 py-1.5 text-[12px] font-medium transition-colors"
          >
            Propor Novo Cálculo
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className={`border ${borders.default} rounded-lg bg-slate-50/20 p-4 space-y-4 max-w-xl`}
        >
          <h4 className={`text-[12px] font-bold uppercase tracking-wider ${text.secondary}`}>
            {supersedeTarget !== null ? 'Propor Substituição de Cálculo' : 'Inserir Novo Cálculo Proposto'}
          </h4>

          {supersedeTarget !== null && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2.5">
              ⚠️ O cálculo atual confirmado ficará arquivado como <strong>Substituído (superseded)</strong>,
              e um novo rascunho <strong>Proposto (proposed)</strong> será criado no histórico para revisão e posterior confirmação.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={`block text-[11px] ${text.faint} mb-1`}>Data de Vigência (Vara/Judicial)</label>
              <input
                type="datetime-local"
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className={`block text-[11px] ${text.faint} mb-1`}>Método / Observação</label>
              <input
                type="text"
                value={calculationMethod}
                onChange={(e) => setCalculationMethod(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className={`block text-[11px] ${text.faint} mb-1`}>Pena Total (dias)</label>
              <input
                type="number"
                value={totalSentenceDays}
                onChange={(e) => setTotalSentenceDays(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                min={1}
                required
              />
            </div>

            <div>
              <label className={`block text-[11px] ${text.faint} mb-1`}>Pena Cumprida (dias)</label>
              <input
                type="number"
                value={servedDays}
                onChange={(e) => setServedDays(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                min={0}
                required
              />
            </div>

            <div>
              <label className={`block text-[11px] ${text.faint} mb-1`}>Remição (dias)</label>
              <input
                type="number"
                value={remissionDays}
                onChange={(e) => setRemissionDays(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                min={0}
                required
              />
            </div>

            <div>
              <label className={`block text-[11px] ${text.faint} mb-1`}>Detração (dias)</label>
              <input
                type="number"
                value={detractionDays}
                onChange={(e) => setDetractionDays(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                min={0}
                required
              />
            </div>
          </div>

          {/* Composição Penal (Crimes) */}
          <div className="pt-2 border-t border-slate-200">
            <CrimeBreakdownForm
              crimes={crimesBreakdown}
              onChange={(newCrimes) => {
                setCrimesBreakdown(newCrimes)
                const newTotal = newCrimes.reduce((acc, c) => acc + c.sentenceDays, 0)
                if (newTotal > 0) setTotalSentenceDays(newTotal)
              }}
            />
          </div>

          {/* Dados do Apenado (Impacto) */}
          <div className="pt-2 border-t border-slate-200">
            <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-700 mb-1">
              <input
                type="checkbox"
                checked={isGenericRecidivist}
                onChange={(e) => setIsGenericRecidivist(e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              Apenado é Reincidente Genérico?
            </label>
            <p className="text-[10px] text-slate-500 ml-6">
              Esta opção impacta as frações de progressão e livramento para os crimes registrados.
            </p>
          </div>

          {supersedeTarget !== null && (
            <div>
              <label className={`block text-[11px] ${text.faint} mb-1`}>Motivo da Substituição (Obrigatório)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex: Correção de erro de digitação / Inclusão de novos dias remidos concedidos pelo Juiz..."
                className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[60px]"
                required
              />
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={isProposing || isSuperseding}
              className="rounded bg-slate-100 hover:bg-slate-200 text-slate-900 px-3.5 py-1.5 text-[12px] font-medium transition-colors"
            >
              {isProposing || isSuperseding ? 'Salvando…' : 'Salvar Rascunho'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-1.5 text-[12px] font-medium transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Seção do Cálculo Confirmado e Ativo */}
      <div className="space-y-3">
        <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${text.muted}`}>
          Cálculo Ativo
        </h4>
        {activeConfirmed ? (
          <ListCard variant="static" accentClassName="border-emerald-200 bg-emerald-50">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700">
                    Confirmado / Operacional
                  </span>
                  <span className={`text-[11px] ${text.faint}`}>
                    Vigência: {formatDate(activeConfirmed.effectiveAt)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-1">
                  <div>
                    <span className={`block text-[10px] ${text.faint} uppercase`}>Pena Total</span>
                    <strong className={`text-[13px] ${text.secondary}`}>{activeConfirmed.totalSentenceDays} dias</strong>
                  </div>
                  <div>
                    <span className={`block text-[10px] ${text.faint} uppercase`}>Pena Cumprida</span>
                    <strong className={`text-[13px] ${text.secondary}`}>{activeConfirmed.servedDays} dias</strong>
                  </div>
                  <div>
                    <span className={`block text-[10px] ${text.faint} uppercase`}>Remição / Detração</span>
                    <strong className={`text-[13px] ${text.secondary}`}>
                      {activeConfirmed.remissionDays} / {activeConfirmed.detractionDays} dias
                    </strong>
                  </div>
                  <div>
                    <span className={`block text-[10px] ${text.faint} uppercase`}>Pena Restante</span>
                    <strong className="text-[13px] text-amber-700">{activeConfirmed.remainingDays} dias</strong>
                  </div>
                </div>

                <div className="text-[11px] flex gap-4 pt-1">
                  <span>
                    <span className={text.faint}>Percentual Cumprido:</span>{' '}
                    <strong className="text-emerald-700">{(Number(activeConfirmed.percentServed) * 100).toFixed(1)}%</strong>
                  </span>
                  {activeConfirmed.calculationMethod && (
                    <span>
                      <span className={text.faint}>Observações:</span> {activeConfirmed.calculationMethod}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleStartSupersede(activeConfirmed)}
                className="shrink-0 rounded border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 text-[11px] font-medium transition-colors"
              >
                Substituir Cálculo
              </button>
            </div>
          </ListCard>
        ) : (
          <EmptyState
            title="Nenhum cálculo confirmado"
            description="Não há cálculos ativos operando no motor. Crie ou confirme um rascunho."
          />
        )}
      </div>

      {/* Rascunhos em Análise */}
      {proposedDrafts.length > 0 && (
        <div className="space-y-3">
          <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${text.muted}`}>
            Rascunhos em Análise / Propostos
          </h4>
          <ul className="space-y-2">
            {proposedDrafts.map((snap) => (
              <li key={snap.id}>
                <ListCard variant="static" accentClassName="border-amber-200 bg-amber-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700">
                          Proposto / Rascunho
                        </span>
                        <span className={`text-[11px] ${text.faint}`}>
                          Vigência: {formatDate(snap.effectiveAt)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <div>
                          <span className={`block text-[10px] ${text.faint} uppercase`}>Pena Total</span>
                          <strong className={`text-[12px] ${text.secondary}`}>{snap.totalSentenceDays} dias</strong>
                        </div>
                        <div>
                          <span className={`block text-[10px] ${text.faint} uppercase`}>Pena Cumprida</span>
                          <strong className={`text-[12px] ${text.secondary}`}>{snap.servedDays} dias</strong>
                        </div>
                        <div>
                          <span className={`block text-[10px] ${text.faint} uppercase`}>Remição / Detração</span>
                          <strong className={`text-[12px] ${text.secondary}`}>
                            {snap.remissionDays} / {snap.detractionDays} dias
                          </strong>
                        </div>
                        <div>
                          <span className={`block text-[10px] ${text.faint} uppercase`}>Pena Restante</span>
                          <strong className="text-[12px] text-amber-700">{snap.remainingDays} dias</strong>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onConfirm(snap.id)}
                      disabled={isConfirming}
                      className="shrink-0 rounded bg-slate-100 hover:bg-slate-200 text-slate-900 px-3 py-1.5 text-[11px] font-semibold transition-colors"
                    >
                      {isConfirming ? 'Confirmando…' : 'Confirmar Cálculo'}
                    </button>
                  </div>
                </ListCard>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Histórico / Substituídos */}
      {historical.length > 0 && (
        <div className="space-y-3">
          <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${text.muted}`}>
            Histórico de Cálculos Substituídos
          </h4>
          <ul className="space-y-2">
            {historical.map((snap) => (
              <li key={snap.id}>
                <ListCard variant="static" accentClassName="border-slate-200/40 bg-slate-50/5">
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600">
                        Substituído / Inativo
                      </span>
                      <span className={`text-[11px] ${text.faint}`}>
                        Vigência: {formatDate(snap.effectiveAt)}
                      </span>
                    </div>
                    <div className={`grid grid-cols-4 gap-4 ${text.secondary}`}>
                      <div>Pena Total: {snap.totalSentenceDays} d</div>
                      <div>Cumprida: {snap.servedDays} d</div>
                      <div>Remição: {snap.remissionDays} d</div>
                      <div>Restante: {snap.remainingDays} d</div>
                    </div>
                    {snap.calculationMethod && (
                      <p className={text.faint}>
                        Observações: {snap.calculationMethod}
                      </p>
                    )}
                  </div>
                </ListCard>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

