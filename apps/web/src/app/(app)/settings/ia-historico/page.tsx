'use client'

/**
 * Histórico da IA — auditoria de todas as chamadas ao Claude (spec §14/§21).
 * Acesso restrito a lawyer/admin (o backend nega para os demais).
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Bot, ChevronDown, ChevronUp } from 'lucide-react'
import { apiGet, ApiError } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'
import { DashboardPageHeader } from '@/components/dashboard'
import { text } from '@/components/dashboard/surfaces'
import { EmptyState, ErrorState, FilterBar, FilterSelect, LoadingState } from '@/components/ui'

type AiLog = {
  id: string
  agent: string
  model: string
  promptText: string | null
  responseText: string | null
  executionCaseId: string | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: string | null
  status: 'success' | 'error'
  errorMessage: string | null
  durationMs: number | null
  createdAt: string
}

type Totals = { total: number; errors: number; inputTokens: number; outputTokens: number; estimatedCostUsd: string }

const AGENT_LABELS: Record<string, string> = {
  extractor: 'Extrator de dados',
  phase_classifier: 'Classificador de fase',
  strategic_reader: 'Leitor estratégico',
  deadline_spotter: 'Conferidor de prazos',
  updater: 'Atualizador',
  draft_generator: 'Gerador de minutas',
  movement_classifier: 'Classificador de movimentações',
  email_parser: 'Parser de e-mail',
  sentence_calculator: 'Cálculo de pena',
}

const AGENT_OPTIONS = [
  { value: '', label: 'Todos os agentes' },
  ...Object.entries(AGENT_LABELS).map(([value, label]) => ({ value, label })),
]

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export default function IaHistoricoPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''
  const [agentFilter, setAgentFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filters = useMemo(
    () => ({ ...(agentFilter !== '' ? { agent: agentFilter } : {}) }),
    [agentFilter]
  )

  const query = useQuery<{ data: AiLog[]; totals: Totals | null }, ApiError>({
    queryKey: ['ai-logs', orgId, filters],
    queryFn: ({ signal }) => apiGet('/api/v1/ai-logs', { organizationId: orgId, signal, params: filters }),
    staleTime: 15 * 1000,
    enabled: orgId !== '' && session != null,
  })

  const logs = query.data?.data ?? []
  const totals = query.data?.totals ?? null

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Sistema"
        title="Histórico da IA"
        description="Trilha de auditoria: prompt, resposta, modelo, tokens e custo de cada chamada."
      />

      {totals !== null && totals.total > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
            <p className="text-[18px] font-semibold text-slate-800">{totals.total}</p>
            <p className="text-[11px] text-slate-500">Chamadas</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
            <p className="text-[18px] font-semibold text-red-700">{totals.errors}</p>
            <p className="text-[11px] text-red-700/80">Erros</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
            <p className="text-[18px] font-semibold text-slate-800">
              {(totals.inputTokens + totals.outputTokens).toLocaleString('pt-BR')}
            </p>
            <p className="text-[11px] text-slate-500">Tokens (entrada+saída)</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
            <p className="text-[18px] font-semibold text-slate-800">
              US$ {Number(totals.estimatedCostUsd).toFixed(4)}
            </p>
            <p className="text-[11px] text-slate-500">Custo estimado</p>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-4">
        <FilterBar>
          <FilterSelect
            id="ai-agent"
            label="Agente"
            value={agentFilter}
            onChange={setAgentFilter}
            options={AGENT_OPTIONS}
            width="select-md"
          />
        </FilterBar>

        {sessionLoading ? (
          <LoadingState label="Carregando sessão…" />
        ) : session === null ? (
          <ErrorState message="Sessão não encontrada. Faça login novamente." />
        ) : query.isLoading ? (
          <LoadingState label="Carregando histórico…" />
        ) : query.isError ? (
          <ErrorState
            message={query.error?.message ?? 'Erro ao carregar histórico.'}
            onRetry={() => { void query.refetch() }}
          />
        ) : logs.length === 0 ? (
          <EmptyState
            title="Nenhuma chamada registrada"
            description="Cada uso da IA (classificar movimentação, gerar minuta, calcular pena) aparecerá aqui automaticamente."
          />
        ) : (
          <div className="space-y-2">
            {logs.map((log) => {
              const isOpen = expanded === log.id
              return (
                <div key={log.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : log.id)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className={`text-[13px] font-semibold ${text.primary}`}>
                        {AGENT_LABELS[log.agent] ?? log.agent}
                      </span>
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                          log.status === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                        }`}
                      >
                        {log.status === 'success' ? 'Sucesso' : 'Erro'}
                      </span>
                      <span className={`text-[11px] ${text.faint}`}>
                        {log.model} · {formatDateTime(log.createdAt)}
                        {log.durationMs !== null ? ` · ${(log.durationMs / 1000).toFixed(1)}s` : ''}
                        {log.inputTokens !== null
                          ? ` · ${(log.inputTokens + (log.outputTokens ?? 0)).toLocaleString('pt-BR')} tokens`
                          : ''}
                        {log.estimatedCostUsd !== null ? ` · US$ ${Number(log.estimatedCostUsd).toFixed(4)}` : ''}
                      </span>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="space-y-3 border-t border-slate-100 px-4 py-3">
                      {log.executionCaseId !== null && (
                        <Link
                          href={`/cases/${log.executionCaseId}`}
                          className="inline-flex rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                        >
                          Abrir caso vinculado
                        </Link>
                      )}
                      {log.errorMessage !== null && (
                        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                          {log.errorMessage}
                        </p>
                      )}
                      {log.promptText !== null && (
                        <div>
                          <p className={`mb-1 text-[11px] font-semibold uppercase ${text.faint}`}>Prompt</p>
                          <pre className="max-h-[240px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700">
                            {log.promptText}
                          </pre>
                        </div>
                      )}
                      {log.responseText !== null && (
                        <div>
                          <p className={`mb-1 text-[11px] font-semibold uppercase ${text.faint}`}>Resposta</p>
                          <pre className="max-h-[240px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700">
                            {log.responseText}
                          </pre>
                        </div>
                      )}
                    </div>
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
