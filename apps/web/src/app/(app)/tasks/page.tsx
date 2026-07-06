'use client'

/**
 * Tarefas — itens operacionais do escritório (workflow_tasks).
 *
 * Diferente de Prazos (obrigações legais) e Oportunidades (vantagens
 * processuais): tarefas são coordenação interna. Máquina de estados completa
 * já existe no backend (claim/release/complete com lock otimista).
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CircleCheck, Hand, Undo2 } from 'lucide-react'
import { apiGet, apiPost, ApiError } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'
import { DashboardPageHeader } from '@/components/dashboard'
import { text } from '@/components/dashboard/surfaces'
import {
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSelect,
  LoadingState,
} from '@/components/ui'

type WorkflowTask = {
  id: string
  taskType: string
  title: string
  description: string | null
  status: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  executionCaseId: string | null
  claimedByUserId: string | null
  assignedToUserId: string | null
  dueAt: string | null
  createdAt: string
}

const STATUS_OPTIONS = [
  { value: '', label: 'Ativas (todas)' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'claimed', label: 'Assumidas' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'blocked', label: 'Bloqueadas' },
  { value: 'completed', label: 'Concluídas' },
  { value: 'cancelled', label: 'Canceladas' },
] as const

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendente', cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  claimed: { label: 'Assumida', cls: 'text-violet-700 bg-violet-50 border-violet-200' },
  in_progress: { label: 'Em andamento', cls: 'text-violet-700 bg-violet-50 border-violet-200' },
  blocked: { label: 'Bloqueada', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  released: { label: 'Liberada', cls: 'text-slate-600 bg-slate-50 border-slate-200' },
  completed: { label: 'Concluída', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  cancelled: { label: 'Cancelada', cls: 'text-slate-500 bg-slate-50 border-slate-200' },
  escalated: { label: 'Escalada', cls: 'text-red-700 bg-red-50 border-red-200' },
}

const PRIORITY_LABELS: Record<string, { label: string; cls: string }> = {
  critical: { label: 'Crítica', cls: 'text-red-700 bg-red-50 border-red-200' },
  high: { label: 'Alta', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  normal: { label: 'Normal', cls: 'text-slate-600 bg-slate-50 border-slate-200' },
  low: { label: 'Baixa', cls: 'text-slate-500 bg-white border-slate-100' },
}

const TASK_TYPE_LABELS: Record<string, string> = {
  review_extraction: 'Revisar extração',
  confirm_document: 'Confirmar documento',
  prepare_piece: 'Preparar peça',
  collect_missing_data: 'Coletar dados',
  confirm_filing: 'Confirmar protocolo',
  review_opportunity: 'Revisar oportunidade',
  case_health_review: 'Saúde do caso',
  deadline_action: 'Ação de prazo',
  intake_triage: 'Triagem de entrada',
  follow_up: 'Follow-up',
  recalculation_review: 'Revisar recálculo',
  pad_defense: 'Defesa em PAD',
  generic: 'Tarefa',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso)
  )
}

export default function TasksPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)

  const filters = useMemo(
    () => ({
      ...(statusFilter !== '' ? { status: statusFilter } : {}),
      ...(onlyMine ? { mine: 'true' } : {}),
    }),
    [statusFilter, onlyMine]
  )

  const query = useQuery<{ data: WorkflowTask[] }, ApiError>({
    queryKey: ['workflow-tasks', orgId, filters],
    queryFn: ({ signal }) =>
      apiGet('/api/v1/queue/workflow-tasks', { organizationId: orgId, signal, params: filters }),
    staleTime: 15 * 1000,
    enabled: orgId !== '' && session != null,
  })

  const action = useMutation<unknown, ApiError, { taskId: string; verb: 'claim' | 'release' | 'complete' }>({
    mutationFn: ({ taskId, verb }) =>
      apiPost(`/api/v1/queue/workflow-tasks/${taskId}/${verb}`, {}, { organizationId: orgId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-tasks', orgId] })
    },
  })

  const tasks = query.data?.data ?? []

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Tarefas"
        description="Itens de trabalho internos — separados de prazos legais e oportunidades."
      />

      <div className="mt-6 space-y-4">
        <FilterBar>
          <FilterSelect
            id="task-status"
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
          />
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-600">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Só as minhas
          </label>
        </FilterBar>

        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : query.isLoading ? (
          <LoadingState label="Carregando tarefas…" />
        ) : query.isError ? (
          <ErrorState
            message={query.error?.message ?? 'Erro ao carregar tarefas.'}
            onRetry={() => { void query.refetch() }}
          />
        ) : tasks.length === 0 ? (
          <EmptyState
            title="Nenhuma tarefa"
            description="Tarefas nascem de oportunidades validadas, prazos, revisões de documentos e rotinas automáticas."
          />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const st = STATUS_LABELS[task.status] ?? STATUS_LABELS['pending']!
              const pr = PRIORITY_LABELS[task.priority] ?? PRIORITY_LABELS['normal']!
              const isMineClaimed = task.claimedByUserId !== null
              const isTerminal = task.status === 'completed' || task.status === 'cancelled'
              return (
                <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${pr.cls}`}>
                          {pr.label}
                        </span>
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                          {st.label}
                        </span>
                        <span className={`text-[11px] uppercase tracking-wide ${text.faint}`}>
                          {TASK_TYPE_LABELS[task.taskType] ?? task.taskType}
                        </span>
                      </div>
                      <p className={`mt-1.5 text-[14px] font-medium ${text.primary}`}>{task.title}</p>
                      {task.description !== null && (
                        <p className={`mt-0.5 line-clamp-2 text-[12px] ${text.muted}`}>{task.description}</p>
                      )}
                      <p className={`mt-1 inline-flex items-center gap-1 text-[11px] ${text.faint}`}>
                        <CalendarClock className="h-3 w-3" /> Vence: {formatDate(task.dueAt)} · Criada:{' '}
                        {formatDate(task.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {task.executionCaseId !== null && (
                        <Link
                          href={`/cases/${task.executionCaseId}`}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                        >
                          Abrir caso
                        </Link>
                      )}
                      {!isTerminal && !isMineClaimed && (
                        <button
                          type="button"
                          onClick={() => action.mutate({ taskId: task.id, verb: 'claim' })}
                          disabled={action.isPending}
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                        >
                          <Hand className="h-3 w-3" /> Assumir
                        </button>
                      )}
                      {!isTerminal && isMineClaimed && (
                        <>
                          <button
                            type="button"
                            onClick={() => action.mutate({ taskId: task.id, verb: 'complete' })}
                            disabled={action.isPending}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                          >
                            <CircleCheck className="h-3 w-3" /> Concluir
                          </button>
                          <button
                            type="button"
                            onClick={() => action.mutate({ taskId: task.id, verb: 'release' })}
                            disabled={action.isPending}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
                          >
                            <Undo2 className="h-3 w-3" /> Liberar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {action.isError && (
                    <p className="mt-2 text-[11px] text-red-600">{action.error?.message}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
