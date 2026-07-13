'use client'

import React, { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useAnalysisStatus,
  useAnalyzeAutos,
  invalidateAnalysisResults,
} from '@/lib/hooks/use-case-crawlers'
import { Button } from '@/components/ui/Button'
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type AnalyzeAutosButtonProps = {
  organizationId: string
  caseId: string
}

/**
 * Dispara a análise dos autos por IA (Claude): gera cálculo de pena (proposto),
 * oportunidades sugeridas e prazos a partir dos autos confirmados do caso.
 * Assíncrono (202 Accepted) — acompanha o progresso via polling em
 * /analysis-status, pois a chamada ao Claude leva 60-120s+.
 */
export function AnalyzeAutosButton({ organizationId, caseId }: AnalyzeAutosButtonProps) {
  const queryClient = useQueryClient()
  const { data: statusData, isLoading: isLoadingStatus } = useAnalysisStatus(organizationId, caseId)
  const trigger = useAnalyzeAutos(organizationId, caseId)

  const run = statusData?.data
  const isRunning = run?.status === 'pending' || run?.status === 'running' || trigger.isPending

  const lastNotifiedRunId = useRef<string | null>(null)
  useEffect(() => {
    if (run?.status === 'success' && run.id !== lastNotifiedRunId.current) {
      lastNotifiedRunId.current = run.id
      invalidateAnalysisResults(queryClient, organizationId, caseId)
    }
  }, [run, queryClient, organizationId, caseId])

  const handleClick = () => {
    trigger.mutate()
  }

  if (isLoadingStatus) {
    return (
      <Button variant="secondary" size="sm" disabled>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando...
      </Button>
    )
  }

  if (isRunning) {
    return (
      <Button variant="secondary" size="sm" disabled className="border-blue-500/50 bg-blue-50 text-blue-700">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Analisando autos…
      </Button>
    )
  }

  // Mensagens completas ficam no tooltip (title) — no header elas aparecem
  // truncadas numa largura fixa pra não espremer o título da página nem
  // empurrar os outros botões pra fora da tela (achado 13/07/2026).
  const successMsg =
    run?.status === 'success' && run.result !== null
      ? `Análise ${run.result.incremental ? 'incremental' : 'completa'} concluída (${run.result.documentosLidos} documento(s) lido(s)): ${run.result.oportunidadesCriadas} oportunidade(s) e ${run.result.prazosCriados} prazo(s).${run.result.snapshotId ? ' Cálculo de pena proposto — confira na aba Cálculos.' : ''}`
      : null

  return (
    <div className="flex min-w-0 items-center gap-3">
      {successMsg && (
        <span
          className="flex min-w-0 max-w-[260px] items-center gap-1.5 text-xs text-emerald-700"
          title={successMsg}
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{successMsg}</span>
        </span>
      )}
      {run?.status === 'failed' && (
        <span
          className="flex min-w-0 max-w-[260px] items-center gap-1.5 text-xs text-red-700"
          title={run.errorDetails ?? 'Erro interno'}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{run.errorDetails ?? 'Falha ao analisar os autos.'}</span>
        </span>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={handleClick}
        className="hover:border-blue-500 hover:text-blue-700 transition-colors"
        title="A IA lê os autos confirmados e gera cálculo de pena, oportunidades e prazos"
      >
        <Sparkles className="mr-2 h-4 w-4" />
        Analisar autos (IA)
      </Button>
    </div>
  )
}
