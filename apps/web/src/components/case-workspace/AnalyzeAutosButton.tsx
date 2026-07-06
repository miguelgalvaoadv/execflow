'use client'

import React, { useState } from 'react'
import { useAnalyzeAutos } from '@/lib/hooks/use-case-crawlers'
import { Button } from '@/components/ui/Button'
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react'

type AnalyzeAutosButtonProps = {
  organizationId: string
  caseId: string
}

/**
 * Dispara a análise dos autos por IA (Claude): gera cálculo de pena (proposto),
 * oportunidades sugeridas e prazos a partir dos autos confirmados do caso.
 */
export function AnalyzeAutosButton({ organizationId, caseId }: AnalyzeAutosButtonProps) {
  const analyze = useAnalyzeAutos(organizationId, caseId)
  const [feedback, setFeedback] = useState<string | null>(null)

  const handleClick = () => {
    setFeedback(null)
    analyze.mutate(undefined, {
      onSuccess: (res) => {
        const d = res.data
        setFeedback(
          `Análise concluída: ${d.oportunidadesCriadas} oportunidade(s) e ${d.prazosCriados} prazo(s).` +
            (d.snapshotId ? ' Cálculo de pena proposto — confira na aba Cálculos.' : '')
        )
      },
      onError: (err) => {
        setFeedback(err.message ?? 'Falha ao analisar os autos.')
      },
    })
  }

  if (analyze.isPending) {
    return (
      <Button variant="secondary" size="sm" disabled className="border-blue-500/50 bg-blue-50 text-blue-700">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Analisando autos…
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {feedback !== null && (
        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {feedback}
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
