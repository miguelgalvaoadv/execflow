'use client'

/**
 * Deadline detail — read + operational actions (acknowledge, complete, dismiss).
 *
 * Route: /deadlines/[deadlineId]
 */

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useSession } from '@/lib/hooks/use-session'
import { useDeadline } from '@/lib/hooks/use-deadline'
import { useDeadlineHistory } from '@/lib/hooks/use-deadline-history'
import {
  useAcknowledgeDeadline,
  useCompleteDeadline,
  useDismissDeadline,
} from '@/lib/hooks/use-deadline-mutations'
import { DashboardPageHeader } from '@/components/dashboard'
import {
  Button,
  ErrorState,
  FieldRow,
  LoadingState,
  PriorityBadge,
  ProfileSection,
  StatusBadge,
} from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import {
  DISMISS_REASON_CODE_LABELS,
  deadlineCardAccentClass,
  deadlineClassLabel,
  deadlineHistoryLabel,
  deadlineOriginLabel,
  deadlinePriorityLabel,
  deadlineStatusLabel,
} from '@/lib/operational/deadline-display'
import type { ApiError } from '@/lib/api-client'

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function mutationErrorMessage(error: ApiError | null): string | null {
  if (error === null || error === undefined) return null
  return error.message ?? 'Operação falhou.'
}

function isLawyerOrAdmin(role: string | undefined): boolean {
  return role === 'lawyer' || role === 'admin'
}

export default function DeadlineDetailPage() {
  const params = useParams()
  const deadlineId = typeof params['deadlineId'] === 'string' ? params['deadlineId'] : ''

  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''
  const role = session?.role

  const deadlineQuery = useDeadline(orgId, deadlineId, session !== null && deadlineId !== '')
  const historyQuery = useDeadlineHistory(orgId, deadlineId, deadlineQuery.isSuccess)

  const acknowledgeMutation = useAcknowledgeDeadline(orgId, deadlineId)
  const completeMutation = useCompleteDeadline(orgId, deadlineId)
  const dismissMutation = useDismissDeadline(orgId, deadlineId)

  const [showDismissForm, setShowDismissForm] = useState(false)
  const [dismissReason, setDismissReason] = useState('')
  const [dismissReasonCode, setDismissReasonCode] = useState('')

  const deadline = deadlineQuery.data?.data
  const history = historyQuery.data?.data ?? []

  const isTerminal = deadline !== undefined && ['completed', 'dismissed'].includes(deadline.status)
  const canAcknowledge =
    deadline !== undefined &&
    (deadline.status === 'open' || deadline.status === 'overdue')
  const canComplete = deadline !== undefined && !isTerminal
  const canDismiss = deadline !== undefined && !isTerminal && isLawyerOrAdmin(role)

  const accent =
    deadline !== undefined
      ? deadlineCardAccentClass(deadline.status, deadline.priority)
      : ''

  const activeMutationError =
    mutationErrorMessage(acknowledgeMutation.error) ??
    mutationErrorMessage(completeMutation.error) ??
    mutationErrorMessage(dismissMutation.error)

  const isMutating =
    acknowledgeMutation.isPending ||
    completeMutation.isPending ||
    dismissMutation.isPending

  function handleDismissSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (dismissReason.trim() === '') return

    const payload: { dismissedReason: string; dismissedReasonCode?: string } = {
      dismissedReason: dismissReason.trim(),
    }
    if (deadline?.status === 'overdue' && dismissReasonCode !== '') {
      payload.dismissedReasonCode = dismissReasonCode
    }

    dismissMutation.mutate(payload, {
      onSuccess: () => {
        setShowDismissForm(false)
        setDismissReason('')
        setDismissReasonCode('')
      },
    })
  }

  return (
    <div>
      {sessionLoading ? (
        <LoadingState label="Carregando sessão…" />
      ) : session === null ? (
        <ErrorState message="Sessão não encontrada. Faça login novamente." />
      ) : deadlineId === '' ? (
        <ErrorState message="Identificador de prazo inválido." />
      ) : deadlineQuery.isLoading ? (
        <LoadingState label="Carregando prazo…" />
      ) : deadlineQuery.isError ? (
        <ErrorState
          message={deadlineQuery.error.message ?? 'Erro ao carregar prazo.'}
          onRetry={() => { void deadlineQuery.refetch() }}
        />
      ) : deadline === undefined ? (
        <ErrorState message="Prazo não encontrado." />
      ) : (
        <>
          <div className="mb-5">
            <Link
              href="/deadlines"
              className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${text.muted} hover:text-zinc-300 transition-colors`}
            >
              ← Prazos
            </Link>
          </div>

          <div className={`rounded-xl border ${borders.subtle} ${surfaces.panel} ${accent} p-4 mb-6`}>
            <DashboardPageHeader
              eyebrow="Prazo"
              title={deadline.title}
              description={[
                deadlineClassLabel(deadline.deadlineClass),
                deadlineStatusLabel(deadline.status),
                `Vencimento ${formatDateTime(deadline.dueAt)}`,
              ].join(' · ')}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge variant="deadline" status={deadline.status} />
              <PriorityBadge variant="deadline" priority={deadline.priority} />
              {deadline.isBlocked && (
                <span className="inline-flex items-center rounded border border-amber-900/40 bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-400">
                  Bloqueado
                </span>
              )}
              {deadline.isStale && (
                <span className="inline-flex items-center rounded border border-zinc-700 bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
                  Desactualizado
                </span>
              )}
            </div>
          </div>

          {!isTerminal && (
            <ProfileSection title="Acções" className="mb-4">
              <div className="flex flex-wrap gap-2">
                {canAcknowledge && (
                  <Button
                    disabled={isMutating}
                    onClick={() => { acknowledgeMutation.mutate() }}
                  >
                    {acknowledgeMutation.isPending ? 'A processar…' : 'Reconhecer'}
                  </Button>
                )}
                {canComplete && (
                  <Button
                    variant="success"
                    disabled={isMutating}
                    onClick={() => { completeMutation.mutate(undefined) }}
                  >
                    {completeMutation.isPending ? 'A processar…' : 'Concluir'}
                  </Button>
                )}
                {canDismiss && !showDismissForm && (
                  <Button
                    disabled={isMutating}
                    onClick={() => { setShowDismissForm(true) }}
                  >
                    Encerrar
                  </Button>
                )}
              </div>

              {showDismissForm && canDismiss && (
                <form onSubmit={handleDismissSubmit} className="mt-4 space-y-3 border-t border-white/[0.04] pt-4">
                  <div>
                    <label htmlFor="dismiss-reason" className={`mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`}>
                      Motivo do encerramento
                    </label>
                    <textarea
                      id="dismiss-reason"
                      required
                      rows={3}
                      value={dismissReason}
                      onChange={(e) => { setDismissReason(e.target.value) }}
                      className={[
                        'w-full rounded-lg border px-3 py-2 text-[13px] outline-none transition-colors',
                        `${borders.default} bg-white/[0.03] ${text.primary}`,
                        'focus:border-white/[0.14] focus:bg-white/[0.05]',
                      ].join(' ')}
                    />
                  </div>
                  {deadline.status === 'overdue' && (
                    <div>
                      <label htmlFor="dismiss-code" className={`mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`}>
                        Código do motivo (obrigatório para vencidos)
                      </label>
                      <select
                        id="dismiss-code"
                        required
                        value={dismissReasonCode}
                        onChange={(e) => { setDismissReasonCode(e.target.value) }}
                        className={[
                          'w-full rounded-lg border px-3 py-2 text-[13px] outline-none transition-colors',
                          `${borders.default} bg-white/[0.03] ${text.primary}`,
                          'focus:border-white/[0.14] focus:bg-white/[0.05]',
                        ].join(' ')}
                      >
                        <option value="">Seleccionar…</option>
                        {Object.entries(DISMISS_REASON_CODE_LABELS).map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={isMutating || dismissReason.trim() === ''}
                    >
                      {dismissMutation.isPending ? 'A processar…' : 'Confirmar encerramento'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={isMutating}
                      onClick={() => {
                        setShowDismissForm(false)
                        setDismissReason('')
                        setDismissReasonCode('')
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              )}

              {activeMutationError !== null && (
                <p className="mt-3 text-[12px] text-red-400" role="alert">
                  {activeMutationError}
                </p>
              )}
            </ProfileSection>
          )}

          <div className="space-y-4">
            <ProfileSection title="Detalhes">
              <dl>
                {deadline.description !== null && deadline.description !== '' && (
                  <FieldRow label="Descrição" value={deadline.description} />
                )}
                <FieldRow
                  label="Classe"
                  value={deadlineClassLabel(deadline.deadlineClass)}
                  debug={deadline.deadlineClass}
                />
                <FieldRow
                  label="Status"
                  value={deadlineStatusLabel(deadline.status)}
                  debug={deadline.status}
                />
                <FieldRow
                  label="Prioridade"
                  value={deadlinePriorityLabel(deadline.priority)}
                  debug={deadline.priority}
                />
                <FieldRow
                  label="Origem"
                  value={deadlineOriginLabel(deadline.origin)}
                  debug={deadline.origin}
                />
                <FieldRow label="Vencimento" value={formatDateTime(deadline.dueAt)} />
                <FieldRow
                  label="Nível de escalada"
                  value={deadline.escalationLevel > 0 ? String(deadline.escalationLevel) : '—'}
                />
                {deadline.escalatedAt !== null && (
                  <FieldRow label="Escalado em" value={formatDateTime(deadline.escalatedAt)} />
                )}
                {deadline.isBlocked && deadline.blockingReason !== null && (
                  <FieldRow label="Motivo do bloqueio" value={deadline.blockingReason} />
                )}
              </dl>
            </ProfileSection>

            <ProfileSection title="Associações">
              <dl>
                <FieldRow
                  label="Execução"
                  value={
                    <Link
                      href={`/cases/${deadline.caseSummary.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      Ref. {deadline.caseSummary.internalRef}
                    </Link>
                  }
                />
                <FieldRow
                  label="Responsável"
                  value={
                    deadline.assigneeUserId !== null
                      ? deadline.assigneeUserId
                      : 'Não atribuído'
                  }
                  debug={
                    deadline.assigneeUserId !== null ? deadline.assigneeUserId : undefined
                  }
                />
              </dl>
            </ProfileSection>

            <ProfileSection title="Datas relevantes">
              <dl>
                <FieldRow label="Criado em" value={formatDateTime(deadline.createdAt)} />
                <FieldRow label="Actualizado em" value={formatDateTime(deadline.updatedAt)} />
                {deadline.acknowledgedAt !== null && (
                  <FieldRow label="Reconhecido em" value={formatDateTime(deadline.acknowledgedAt)} />
                )}
                {deadline.completedAt !== null && (
                  <FieldRow label="Concluído em" value={formatDateTime(deadline.completedAt)} />
                )}
                {deadline.dismissedAt !== null && (
                  <>
                    <FieldRow label="Encerrado em" value={formatDateTime(deadline.dismissedAt)} />
                    {deadline.dismissedReason !== null && (
                      <FieldRow label="Motivo do encerramento" value={deadline.dismissedReason} />
                    )}
                    {deadline.dismissedReasonCode !== null && (
                      <FieldRow
                        label="Código do motivo"
                        value={
                          DISMISS_REASON_CODE_LABELS[deadline.dismissedReasonCode] ??
                          deadline.dismissedReasonCode
                        }
                        debug={deadline.dismissedReasonCode}
                      />
                    )}
                  </>
                )}
              </dl>
            </ProfileSection>

            <ProfileSection title="Histórico">
              {historyQuery.isLoading ? (
                <LoadingState label="Carregando histórico…" />
              ) : historyQuery.isError ? (
                <ErrorState
                  message={historyQuery.error.message ?? 'Erro ao carregar histórico.'}
                  onRetry={() => { void historyQuery.refetch() }}
                />
              ) : history.length === 0 ? (
                <p className={`text-[13px] ${text.faint}`}>Sem registos de histórico.</p>
              ) : (
                <ul className="space-y-3" aria-label="Histórico do prazo">
                  {history.map((entry) => (
                    <li
                      key={entry.id}
                      className="border-b border-white/[0.04] pb-3 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className={`text-[13px] font-medium ${text.secondary}`}>
                          {deadlineHistoryLabel(entry.changeType, entry.newValue)}
                        </p>
                        <time
                          dateTime={entry.changedAt}
                          className={`text-[11px] tabular-nums ${text.faint}`}
                        >
                          {formatDateTime(entry.changedAt)}
                        </time>
                      </div>
                      {entry.reason !== null && entry.reason !== '' && (
                        <p className={`mt-1 text-[12px] ${text.faint}`}>{entry.reason}</p>
                      )}
                      <p className={`mt-0.5 text-[10px] ${text.faint}`}>
                        Actor: {entry.changedByActorType}
                        {entry.changedByUserId !== null ? ` · ${entry.changedByUserId}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </ProfileSection>
          </div>
        </>
      )}
    </div>
  )
}
