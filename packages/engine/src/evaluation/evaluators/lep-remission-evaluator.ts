/**
 * LEP Remission Evaluator — Remição de Pena
 *
 * Calcula a remição de pena conforme a LEP (Art. 126-130):
 *
 * REMIÇÃO POR TRABALHO (Art. 126, LEP):
 * - 1 dia remido a cada 3 dias trabalhados
 * - Aplicável ao preso que cumpre pena em regime fechado ou semiaberto
 *
 * REMIÇÃO POR ESTUDO (Art. 126, §1º, LEP):
 * - 1 dia remido a cada 12 horas de frequência escolar
 * - Divisão em no mínimo 3 dias
 * - Aplicável inclusive em regime aberto e livramento condicional
 *
 * REMIÇÃO POR LEITURA (Recomendação CNJ 44/2013):
 * - 4 dias de remição por obra lida (prazo de 21 a 30 dias)
 * - Comprovação por resenha de no mínimo 1 página
 *
 * CUMULAÇÃO (Art. 126, §3º, LEP):
 * - Trabalho e estudo podem ser cumulados (1/3 de acréscimo)
 *
 * PERDA (Art. 127, LEP):
 * - Falta grave: perda de até 1/3 do tempo remido
 * - Reinício da contagem a partir da data da infração
 *
 * Este evaluator NÃO calcula remição — ele VERIFICA se os dias remidos
 * registrados no snapshot são suficientes para gerar uma oportunidade.
 * O cálculo real de remição vem dos eventos homologados.
 *
 * Architecture ref: execution-engine.md §3.3 (remission engine).
 */

import type { RuleEvaluatorInput, RuleEvaluatorOutput } from '../../types/index.ts'

/**
 * Evaluator puro de remição.
 * Registrado no registry com id 'lepRemission'.
 */
export function lepRemissionEvaluator(input: RuleEvaluatorInput): RuleEvaluatorOutput {
  const { facts, parameters, ruleId, playbookVersionId } = input

  if (facts.sentence === null) {
    return insufficientData('sentence_snapshot', 'Snapshot de sentença necessário para avaliar impacto de remição')
  }

  const sentence = facts.sentence
  const totalDays = sentence.totalSentenceDays
  const remissionDays = sentence.remissionDays

  // ---- Parameters from playbook ----
  const workRatio = parameters['workRatio'] as number | undefined ?? 3  // 3 days worked = 1 remitted
  const studyHoursPerDay = parameters['studyHoursPerDay'] as number | undefined ?? 12
  const readingDaysPerBook = parameters['readingDaysPerBook'] as number | undefined ?? 4
  const cumulationBonus = parameters['cumulationBonus'] as number | undefined ?? (1 / 3) // +1/3 when cumulating

  // ---- Assess remission impact ----
  if (totalDays <= 0) {
    return insufficientData('total_sentence_days', 'Pena total deve ser > 0')
  }

  const remissionPercentage = totalDays > 0 ? (remissionDays / totalDays) * 100 : 0
  const servedPlusRemission = sentence.servedDays + remissionDays + sentence.detractionDays
  const remainingAfterRemission = Math.max(0, totalDays - servedPlusRemission)

  const outputConfidence = sentence.confidenceLevel === 'high'
    ? 'high' as const
    : sentence.confidenceLevel === 'medium'
      ? 'medium' as const
      : 'low' as const

  const calculations = [
    {
      name: 'Impacto da remição na pena',
      inputs: {
        penaTotalDias: totalDays,
        diasRemidos: remissionDays,
        diasCumpridos: sentence.servedDays,
        diasDetração: sentence.detractionDays,
        percentualRemido: `${remissionPercentage.toFixed(2)}%`,
      },
      output: `${remissionDays} dias remidos (${remissionPercentage.toFixed(2)}% da pena). Restam ${remainingAfterRemission} dias.`,
      confidence: outputConfidence,
      derivationNote: `Remição homologada registrada no snapshot. Proporções: trabalho (${workRatio}:1), estudo (${studyHoursPerDay}h:1), leitura (1 obra:${readingDaysPerBook}d).`,
    },
    {
      name: 'Parâmetros de remição do playbook',
      inputs: {
        razãoTrabalho: `${workRatio} dias trabalhados = 1 dia remido`,
        razãoEstudo: `${studyHoursPerDay} horas = 1 dia remido`,
        razãoLeitura: `1 obra = ${readingDaysPerBook} dias remidos`,
        bônusCumulação: `+${(cumulationBonus * 100).toFixed(0)}% (trabalho + estudo simultâneo)`,
      },
      output: 'Parâmetros de cálculo de remição conforme Art. 126, LEP',
      confidence: 'high' as const,
      derivationNote: `Parâmetros do playbook v${playbookVersionId}. Art. 126 e §§ da LEP.`,
    },
  ]

  // ---- Generate warning if remission is significant ----
  // Remission is informational — it doesn't generate a standalone opportunity
  // but it's a "snapshot_proposal" when there are unrecorded remission days
  const hasSignificantRemission = remissionDays > 0

  return {
    outcome: hasSignificantRemission ? 'opportunity_suggested' : 'no_match',
    confidenceLevel: outputConfidence,
    uncertaintyLevel: outputConfidence === 'high' ? 'none' : 'low',
    blockingCodes: [],
    uncertaintyFactors: [],
    missingData: sentence.missingDataFlags.map((f) => ({
      field: f.field,
      whyNeeded: f.description,
      severity: f.impact === 'high' ? 'critical' as const : 'recommended' as const,
    })),
    legalRulesApplied: [{
      ruleId,
      playbookVersionId,
      branchId: null,
      citationRef: 'Art. 126-130, LEP (Lei 7.210/84)',
    }],
    calculations,
    ...(hasSignificantRemission ? {
      opportunityProposal: {
        opportunityType: 'remission_impact',
        summary: `Remição ativa: ${remissionDays} dias remidos (${remissionPercentage.toFixed(1)}% da pena) — impacta datas de progressão e livramento`,
        rationale: `${remissionDays} dias de remição homologados reduzem efetivamente a pena restante para ${remainingAfterRemission} dias. Impacta diretamente o cálculo de frações para progressão e livramento.`,
        windowStartAt: null,
        windowEndAt: null,
        riskLevel: 'low' as const,
        requiresLawyerReview: false,
      },
    } : {}),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insufficientData(field: string, reason: string): RuleEvaluatorOutput {
  return {
    outcome: 'insufficient_data',
    confidenceLevel: 'unknown',
    uncertaintyLevel: 'blocking',
    blockingCodes: [],
    uncertaintyFactors: [],
    missingData: [{ field, whyNeeded: reason, severity: 'critical' }],
    legalRulesApplied: [],
    calculations: [],
  }
}
