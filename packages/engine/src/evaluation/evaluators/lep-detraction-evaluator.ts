/**
 * LEP Detraction Evaluator — Detração Penal
 *
 * Calcula e avalia a detração penal conforme o Art. 42 do Código Penal:
 *
 * DETRAÇÃO (Art. 42, CP):
 * "Computam-se, na pena privativa de liberdade e na medida de segurança,
 *  o tempo de prisão provisória, no Brasil ou no estrangeiro, o de prisão
 *  administrativa e o de internação em qualquer dos estabelecimentos
 *  referidos no artigo anterior."
 *
 * TIPOS DE TEMPO DETRAÍVEL:
 * - Prisão em flagrante
 * - Prisão preventiva
 * - Prisão temporária
 * - Prisão administrativa
 * - Internação provisória em medida de segurança
 *
 * O evaluator verifica os dias de detração registrados no snapshot e
 * avalia se há oportunidade de reconhecimento de detração não computada.
 *
 * Architecture ref: execution-engine.md §3.4 (detraction engine).
 */

import type { RuleEvaluatorInput, RuleEvaluatorOutput } from '../../types/index.ts'

/**
 * Evaluator puro de detração.
 * Registrado no registry com id 'lepDetraction'.
 */
export function lepDetractionEvaluator(input: RuleEvaluatorInput): RuleEvaluatorOutput {
  const { facts, parameters, ruleId, playbookVersionId } = input

  if (facts.sentence === null) {
    return insufficientData('sentence_snapshot', 'Snapshot de sentença necessário para avaliar detração')
  }

  const sentence = facts.sentence
  const totalDays = sentence.totalSentenceDays
  const detractionDays = sentence.detractionDays

  if (totalDays <= 0) {
    return insufficientData('total_sentence_days', 'Pena total deve ser > 0')
  }

  // ---- Parameters from playbook ----
  const minDetractionDaysToReport = parameters['minDetractionDaysToReport'] as number | undefined ?? 1

  const detractionPercentage = totalDays > 0 ? (detractionDays / totalDays) * 100 : 0
  const servedTotal = sentence.servedDays + sentence.remissionDays + detractionDays
  const remainingAfterDetraction = Math.max(0, totalDays - servedTotal)

  const outputConfidence = sentence.confidenceLevel === 'high'
    ? 'high' as const
    : sentence.confidenceLevel === 'medium'
      ? 'medium' as const
      : 'low' as const

  const calculations = [
    {
      name: 'Detração reconhecida',
      inputs: {
        penaTotalDias: totalDays,
        diasDetração: detractionDays,
        percentualDetração: `${detractionPercentage.toFixed(2)}%`,
        diasCumpridos: sentence.servedDays,
        diasRemidos: sentence.remissionDays,
      },
      output: `${detractionDays} dias de detração (${detractionPercentage.toFixed(2)}% da pena). Pena remanescente: ${remainingAfterDetraction} dias.`,
      confidence: outputConfidence,
      derivationNote: `Detração conforme Art. 42, CP. Tempo de prisão provisória, administrativa ou internação anterior computado na pena.`,
    },
  ]

  const hasDetraction = detractionDays >= minDetractionDaysToReport

  return {
    outcome: hasDetraction ? 'opportunity_suggested' : 'no_match',
    confidenceLevel: outputConfidence,
    uncertaintyLevel: outputConfidence === 'high' ? 'none' : 'low',
    blockingCodes: [],
    uncertaintyFactors: detractionDays === 0 ? [{
      code: 'INCOMPLETE_RECORDS',
      message: 'Nenhum dia de detração registrado — verificar se houve prisão provisória não computada',
      affectedOutputs: ['detraction_days', 'remaining_penalty'],
    }] : [],
    missingData: detractionDays === 0 ? [{
      field: 'detraction_days',
      whyNeeded: 'Verificar se houve prisão provisória, preventiva ou temporária não computada como detração',
      severity: 'recommended' as const,
    }] : [],
    legalRulesApplied: [{
      ruleId,
      playbookVersionId,
      branchId: null,
      citationRef: 'Art. 42, CP (Decreto-Lei 2.848/40)',
    }],
    calculations,
    ...(hasDetraction ? {
      opportunityProposal: {
        opportunityType: 'detraction',
        summary: `Detração penal: ${detractionDays} dias de prisão provisória computados (${detractionPercentage.toFixed(1)}% da pena)`,
        rationale: `${detractionDays} dias de detração reduzem a pena remanescente para ${remainingAfterDetraction} dias, impactando datas de progressão e livramento. Art. 42, CP.`,
        windowStartAt: null,
        windowEndAt: null,
        riskLevel: 'medium' as const,
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
