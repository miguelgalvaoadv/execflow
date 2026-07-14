'use client'

/**
 * Início — centro operacional do ExecFlow.
 *
 * Redesenhada em 14/07/2026 para refletir o que o advogado realmente usa no
 * dia a dia (intimações, prazos, tarefas, oportunidades, agenda, casos) com
 * NÚMEROS REAIS (COUNT no banco via /api/v1/dashboard/summary — não mais o
 * tamanho da página limitado a 50). Removidos painéis internos que estavam
 * vazios ou desconectados (fila de projeções por worker, pipeline de extração,
 * motor de cálculo) e o link quebrado para a antiga central de Documentos.
 *
 * Cada bloco lê o endpoint real do módulo — em sincronia com o que acontece
 * em cada caso.
 */

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'
import { useDashboardSummary } from '@/lib/hooks/use-dashboard-summary'
import { useDeadlines } from '@/lib/hooks/use-deadlines'
import { useCalendar } from '@/lib/hooks/use-calendar'
import { useOpportunities } from '@/lib/hooks/use-opportunities'
import { DashboardPageHeader, WorkspacePanel } from '@/components/dashboard'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import { EmptyState, ErrorState, ListCard, LoadingState, StatusBadge } from '@/components/ui'
import { deadlineCardAccentClass, deadlineClassLabel } from '@/lib/operational/deadline-display'

// ---------------------------------------------------------------------------
// Tipos locais (respostas de endpoints reais)
// ---------------------------------------------------------------------------

type IntimationItem = {
  id: string
  processNumber: string | null
  kind: string
  status: string
  clientName: string | null
  caseInternalRef: string | null
  executionCaseId: string | null
  createdAt: string
  availableAt: string | null
}

type OpenTask = {
  id: string
  title: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  status: string
  dueAt: string | null
  clientName: string | null
  processNumber: string | null
  executionCaseId: string | null
}

const TASK_PRIORITY_BADGE: Record<string, string> = {
  critical: 'text-red-700 bg-red-50 border-red-200',
  high: 'text-orange-700 bg-orange-50 border-orange-200',
  normal: 'text-slate-600 bg-slate-100 border-slate-200',
  low: 'text-slate-500 bg-slate-50 border-slate-200',
}
const TASK_PRIORITY_LABEL: Record<string, string> = {
  critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}
function todayRangeIso(): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}

// ---------------------------------------------------------------------------
// Cartão de métrica (número REAL, com acento de urgência)
// ---------------------------------------------------------------------------

function MetricCard({
  title, count, href, loading, tone = 'neutral', description,
}: {
  title: string; count: number | null; href: string; loading?: boolean
  tone?: 'neutral' | 'alert'; description?: string
}) {
  const alert = tone === 'alert' && (count ?? 0) > 0
  return (
    <Link
      href={href}
      className={[
        'group flex flex-col justify-between rounded-xl border px-4 py-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        alert ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white',
      ].join(' ')}
    >
      <p className={`text-[11px] font-medium uppercase tracking-[0.06em] ${alert ? 'text-red-600' : 'text-slate-500'}`}>
        {title}
      </p>
      <p className={`mt-2 text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em] ${alert ? 'text-red-700' : 'text-slate-900'}`}>
        {loading || count === null ? '—' : count}
      </p>
      {description && <p className="mt-1.5 text-[11px] text-slate-400">{description}</p>}
    </Link>
  )
}

function PanelFooterLink({ href, label }: { href: string; label: string }) {
  return (
    <div className={`mt-4 border-t ${borders.subtle} pt-3`}>
      <Link href={href} className={`text-[12px] ${text.faint} hover:text-slate-700 transition-colors`}>
        {label} →
      </Link>
    </div>
  )
}

const QUICK_LINKS = [
  { href: '/cases', label: 'Execuções' },
  { href: '/clients', label: 'Clientes' },
  { href: '/intimations', label: 'Intimações' },
  { href: '/deadlines', label: 'Prazos' },
  { href: '/opportunities', label: 'Oportunidades' },
  { href: '/calendar', label: 'Agenda' },
  { href: '/tasks', label: 'Tarefas' },
  { href: '/finance', label: 'Financeiro' },
] as const

export default function DashboardPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''
  const ready = session !== null && session !== undefined

  const summary = useDashboardSummary(orgId, ready)

  const overdue = useDeadlines({ organizationId: orgId, filters: { status: 'overdue' }, limit: 20, enabled: ready })
  const weekQuery = useDeadlines({ organizationId: orgId, limit: 50, enabled: ready })
  const opportunities = useOpportunities({ organizationId: orgId, filters: { status: 'suggested' }, limit: 5, enabled: ready })

  const { from, to } = useMemo(() => todayRangeIso(), [])
  const todayAgenda = useCalendar(orgId, from, to, ['manual'], ready)

  const newIntimations = useQuery<{ data: IntimationItem[] }, ApiError>({
    queryKey: ['dash-intimations', orgId],
    queryFn: ({ signal }) => apiGet('/api/v1/communications', { organizationId: orgId, signal, params: { status: 'new', limit: 8 } }),
    enabled: ready && orgId !== '',
    staleTime: 30 * 1000,
  })

  const openTasks = useQuery<{ data: OpenTask[] }, ApiError>({
    queryKey: ['dash-tasks', orgId],
    queryFn: ({ signal }) => apiGet('/api/v1/queue/workflow-tasks', { organizationId: orgId, signal, params: { limit: 6 } }),
    enabled: ready && orgId !== '',
    staleTime: 30 * 1000,
  })

  const overdueItems = overdue.data?.pages.flatMap((p) => p.data) ?? []
  const intimationItems = newIntimations.data?.data ?? []

  const weekDeadlines = useMemo(() => {
    const items = weekQuery.data?.pages.flatMap((p) => p.data) ?? []
    const now = new Date()
    const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7)
    return items
      .filter((d) => !['completed', 'dismissed', 'overdue'].includes(d.status) && new Date(d.dueAt) <= weekEnd)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 6)
  }, [weekQuery.data])

  if (sessionLoading) return <LoadingState label="Carregando sessão…" />
  if (session === null || session === undefined) return <ErrorState message="Sessão não encontrada. Faça login novamente." />

  const roleLabel = session.role === 'admin' ? 'Administrador' : session.role === 'lawyer' ? 'Advogado' : 'Assistente'
  const s = summary.data

  const attentionEmpty = overdueItems.length === 0 && intimationItems.length === 0

  return (
    <div>
      <DashboardPageHeader eyebrow="Início" title={session.organization.name} description={`Centro operacional · ${roleLabel}`} />

      <div className="mt-6 space-y-6">
        {/* Resumo — números reais */}
        <section aria-label="Resumo operacional">
          <h2 className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${text.muted} mb-3`}>Resumo de hoje</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <MetricCard title="Intimações novas" count={s?.newIntimations ?? null} href="/intimations" loading={summary.isLoading} tone="alert" description="Não vistas" />
            <MetricCard title="Prazos vencidos" count={s?.overdueDeadlines ?? null} href="/deadlines" loading={summary.isLoading} tone="alert" description="Ação imediata" />
            <MetricCard title="Prazos em 7 dias" count={s?.weekDeadlines ?? null} href="/deadlines" loading={summary.isLoading} description="Próxima semana" />
            <MetricCard title="Tarefas abertas" count={s?.openTasks ?? null} href="/tasks" loading={summary.isLoading} description="A fazer" />
            <MetricCard title="Oportunidades" count={s?.openOpportunities ?? null} href="/opportunities" loading={summary.isLoading} description="Em aberto" />
            <MetricCard title="Casos ativos" count={s?.activeCases ?? null} href="/cases" loading={summary.isLoading} description={`${s?.activeClients ?? '—'} clientes`} />
          </div>
        </section>

        {/* Precisa de atenção agora — prazos vencidos + intimações novas */}
        <WorkspacePanel title="Precisa de atenção agora" description="Prazos vencidos e intimações novas — o que não pode esperar.">
          {overdue.isLoading || newIntimations.isLoading ? (
            <LoadingState label="Carregando…" />
          ) : overdue.isError ? (
            <ErrorState message={overdue.error?.message ?? 'Erro ao carregar.'} onRetry={() => { void overdue.refetch() }} />
          ) : attentionEmpty ? (
            <EmptyState title="Nada urgente" description="Nenhum prazo vencido e nenhuma intimação nova. Tudo em dia." />
          ) : (
            <>
              <ul className="space-y-2">
                {overdueItems.slice(0, 6).map((d) => (
                  <li key={`dl-${d.id}`}>
                    <ListCard href={d.executionCaseId ? `/cases/${d.executionCaseId}?tab=prazos` : `/deadlines/${d.id}`} accentClassName="border-red-200 bg-red-50">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <StatusBadge variant="deadline" status={d.status} />
                        <span className={`text-[11px] ${text.faint}`}>{deadlineClassLabel(d.deadlineClass)}</span>
                      </div>
                      <p className={`text-[13px] font-medium ${text.secondary}`}>{d.title}</p>
                      <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                        Venceu em {formatDate(d.dueAt)}{d.clientName ? ` · ${d.clientName}` : ''}
                      </p>
                    </ListCard>
                  </li>
                ))}
                {intimationItems.slice(0, 6).map((it) => (
                  <li key={`int-${it.id}`}>
                    <ListCard href={it.executionCaseId ? `/cases/${it.executionCaseId}?tab=intimacoes` : '/intimations'} accentClassName="border-blue-200 bg-blue-50">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">Intimação nova</span>
                        <span className={`text-[11px] ${text.faint}`}>{it.kind}</span>
                      </div>
                      <p className={`text-[13px] font-medium ${text.secondary}`}>{it.clientName ?? it.processNumber ?? 'Comunicação'}</p>
                      <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                        {it.processNumber ?? '—'} · recebida {formatDate(it.availableAt ?? it.createdAt)}
                      </p>
                    </ListCard>
                  </li>
                ))}
              </ul>
              <PanelFooterLink href="/queues" label="Ver Radar completo" />
            </>
          )}
        </WorkspacePanel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Prazos da semana */}
          <WorkspacePanel title="Prazos da semana" description="Vencimentos nos próximos 7 dias.">
            {weekQuery.isLoading ? (
              <LoadingState label="Carregando prazos…" />
            ) : weekQuery.isError ? (
              <ErrorState message={weekQuery.error.message ?? 'Erro ao carregar prazos.'} onRetry={() => { void weekQuery.refetch() }} />
            ) : weekDeadlines.length === 0 ? (
              <EmptyState title="Sem prazos esta semana" description="Nenhum prazo ativo vence nos próximos 7 dias." />
            ) : (
              <>
                <ul className="space-y-2">
                  {weekDeadlines.map((d) => (
                    <li key={d.id}>
                      <ListCard href={d.executionCaseId ? `/cases/${d.executionCaseId}?tab=prazos` : `/deadlines/${d.id}`} accentClassName={deadlineCardAccentClass(d.status, d.priority)}>
                        <div className="flex flex-wrap items-center gap-2 mb-0.5">
                          <StatusBadge variant="deadline" status={d.status} />
                          <span className={`text-[11px] ${text.faint}`}>{deadlineClassLabel(d.deadlineClass)}</span>
                        </div>
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{d.title}</p>
                        <p className={`mt-0.5 text-[11px] ${text.faint}`}>Vence {formatDate(d.dueAt)}{d.clientName ? ` · ${d.clientName}` : ''}</p>
                      </ListCard>
                    </li>
                  ))}
                </ul>
                <PanelFooterLink href="/deadlines" label="Ver todos os prazos" />
              </>
            )}
          </WorkspacePanel>

          {/* Agenda de hoje */}
          <WorkspacePanel title="Agenda de hoje" description="Audiências, reuniões e lembretes de hoje.">
            {todayAgenda.isLoading ? (
              <LoadingState label="Carregando agenda…" />
            ) : todayAgenda.isError ? (
              <ErrorState message="Erro ao carregar a agenda." onRetry={() => { void todayAgenda.refetch() }} />
            ) : (todayAgenda.data?.data ?? []).length === 0 ? (
              <EmptyState title="Nada agendado hoje" description="Sem eventos manuais para hoje." />
            ) : (
              <>
                <ul className="space-y-2">
                  {(todayAgenda.data?.data ?? []).slice(0, 6).map((ev) => (
                    <li key={ev.id}>
                      <ListCard href={ev.executionCaseId ? `/cases/${ev.executionCaseId}` : '/calendar'}>
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{ev.title}</p>
                        <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                          {ev.allDay ? 'Dia inteiro' : formatTime(ev.startsAt)}{ev.clientName ? ` · ${ev.clientName}` : ''}
                        </p>
                      </ListCard>
                    </li>
                  ))}
                </ul>
                <PanelFooterLink href="/calendar" label="Abrir agenda" />
              </>
            )}
          </WorkspacePanel>

          {/* Tarefas abertas */}
          <WorkspacePanel title="Tarefas abertas" description="Suas próximas tarefas, por prioridade.">
            {openTasks.isLoading ? (
              <LoadingState label="Carregando tarefas…" />
            ) : openTasks.isError ? (
              <ErrorState message={openTasks.error?.message ?? 'Erro ao carregar tarefas.'} onRetry={() => { void openTasks.refetch() }} />
            ) : (openTasks.data?.data ?? []).length === 0 ? (
              <EmptyState title="Nenhuma tarefa aberta" description="Tudo concluído por aqui." />
            ) : (
              <>
                <ul className="space-y-2">
                  {(openTasks.data?.data ?? []).map((t) => (
                    <li key={t.id}>
                      <ListCard href={t.executionCaseId ? `/cases/${t.executionCaseId}?tab=tarefas` : '/tasks'}>
                        <div className="flex flex-wrap items-center gap-2 mb-0.5">
                          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${TASK_PRIORITY_BADGE[t.priority] ?? ''}`}>
                            {TASK_PRIORITY_LABEL[t.priority] ?? t.priority}
                          </span>
                          {t.dueAt && <span className={`text-[11px] ${text.faint}`}>Vence {formatDate(t.dueAt)}</span>}
                        </div>
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{t.title}</p>
                        {(t.clientName || t.processNumber) && (
                          <p className={`mt-0.5 text-[11px] ${text.faint}`}>{[t.clientName, t.processNumber].filter(Boolean).join(' · ')}</p>
                        )}
                      </ListCard>
                    </li>
                  ))}
                </ul>
                <PanelFooterLink href="/tasks" label="Ver todas as tarefas" />
              </>
            )}
          </WorkspacePanel>

          {/* Oportunidades */}
          <WorkspacePanel title="Oportunidades a revisar" description="Sugestões aguardando sua qualificação.">
            {opportunities.isLoading ? (
              <LoadingState label="Carregando oportunidades…" />
            ) : opportunities.isError ? (
              <ErrorState message={opportunities.error?.message ?? 'Erro ao carregar.'} onRetry={() => { void opportunities.refetch() }} />
            ) : (opportunities.data?.pages.flatMap((p) => p.data) ?? []).length === 0 ? (
              <EmptyState title="Sem oportunidades pendentes" description="Nenhuma sugestão aguardando revisão." />
            ) : (
              <>
                <ul className="space-y-2">
                  {(opportunities.data?.pages.flatMap((p) => p.data) ?? []).slice(0, 6).map((op) => (
                    <li key={op.id}>
                      <ListCard href={`/cases/${op.executionCaseId}?tab=oportunidades`}>
                        <p className={`text-[13px] font-medium ${text.secondary}`}>{op.summary}</p>
                        <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                          {op.clientName ?? op.caseInternalRef ?? '—'}
                          {op.windowEndAt ? ` · janela até ${formatDate(op.windowEndAt)}` : ''}
                        </p>
                      </ListCard>
                    </li>
                  ))}
                </ul>
                <PanelFooterLink href="/opportunities" label="Ver todas as oportunidades" />
              </>
            )}
          </WorkspacePanel>
        </div>

        {/* Acesso rápido */}
        <WorkspacePanel title="Acesso rápido" description="Módulos do ExecFlow.">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={['block rounded-lg border px-4 py-3 text-center transition-colors hover:bg-slate-50', borders.subtle, surfaces.panelInset].join(' ')}>
                  <p className={`text-[13px] font-medium ${text.secondary}`}>{link.label}</p>
                </Link>
              </li>
            ))}
          </ul>
        </WorkspacePanel>
      </div>
    </div>
  )
}
