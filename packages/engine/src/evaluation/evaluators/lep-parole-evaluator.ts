/**
 * LEP Parole Evaluator — Livramento Condicional
 *
 * Implementa o cálculo de livramento condicional baseado nas frações
 * do Código Penal e da LEP com alterações do Pacote Anticrime.
 *
 * FRAÇÕES DE LIVRAMENTO CONDICIONAL:
 * - 1/3 (≈33.33%) → Crime comum, primário, bom comportamento (Art. 83, I, CP)
 * - 1/2 (50%)     → Crime comum, reincidente (Art. 83, II, CP)
 * - 2/3 (≈66.67%) → Crime hediondo/equiparado, primário (Art. 83, V, CP)
 * - VEDADO        → Reincidente específico em crime hediondo (Art. 83, V, CP)
 *
 * REQUISITOS SUBJETIVOS (avaliados como blocking conditions):
 * - Bom comportamento carcerário comprovado
 * - Aptidão para prover subsistência por trabalho lícito
 * - Reparação do dano (quando aplicável)
 * - Para crimes com violência: cessação de periculosidade (exame criminológico)
 *
 * Architecture ref: execution-engine.md §3.2 (parole engine).
 */

import type { RuleEvaluatorInput, RuleEvaluatorOutput } from '../../types/index.ts'

/**
 * Evaluator puro de livramento condicional.
 * Registrado no registry com id 'lepParoleFraction'.
 */
export function lepParoleFractionEvaluator(input: RuleEvaluatorInput): RuleEvaluatorOutput {
  const { facts, parameters, ruleId, playbookVersionId, activeBlockingCodes } = input

  // ---- Check global blocking conditions ----
  const blockers = activeBlockingCodes.filter((code) =>
    ['BLK_ESCAPE', 'BLK_SNAPSHOT_UNCONFIRMED', 'BLK_UNIFICATION_PENDING'].includes(code)
  )
  if (blockers.length > 0) {
    return blocked(blockers)
  }

  // ---- Require sentence facts ----
  if (facts.sentence === null) {
    return insufficientData('sentence_snapshot', 'Snapshot de sentença confirmado necessário para cálculo de livramento')
  }

  // ---- Check if parole is prohibited (reincidente específico em hediondo) ----
  const isProhibited = parameters['isProhibited'] as boolean | undefined
  if (isProhibited === true) {
    return {
      outcome: 'opportunity_blocked',
      confidenceLevel: 'high',
      uncertaintyLevel: 'none',
      blockingCodes: ['BLK_PAROLE_PROHIBITED'],
      uncertaintyFactors: [],
      missingData: [],
      legalRulesApplied: [{
        ruleId,
        playbookVersionId,
        branchId: null,
        citationRef: 'Art. 83, V, CP — Vedado para reincidente específico em crime hediondo',
      }],
      calculations: [{
        name: 'Vedação de livramento condicional',
        inputs: { motivoVedação: 'Reincidência específica em crime hediondo/equiparado' },
        output: 'VEDADO — livramento condicional não é cabível',
        confidence: 'high',
        derivationNote: 'Art. 83, V, do Código Penal veda o livramento condicional ao reincidente específico em crime hediondo.',
      }],
    }
  }

  // ---- Extract playbook parameters ----
  const requiredFraction = parameters['requiredFraction'] as number | undefined
  const requiresGoodBehavior = parameters['requiresGoodBehavior'] as boolean | undefined ?? true
  const requiresCriminologicalExam = parameters['requiresCriminologicalExam'] as boolean | undefined ?? false

  if (requiredFraction === undefined) {
    return insufficientData('playbook_parameters', 'requiredFraction deve estar configurado no playbook para livramento')
  }

  const sentence = facts.sentence
  const totalDays = sentence.totalSentenceDays

  if (totalDays <= 0) {
    return insufficientData('total_sentence_days', 'Pena total em dias deve ser > 0')
  }

  // ---- Minimum sentence check (Art. 83, caput, CP: pena ≥ 2 anos) ----
  const minSentenceDays = parameters['minSentenceDays'] as number | undefined ?? 730 // 2 years
  if (totalDays < minSentenceDays) {
    return {
      outcome: 'no_match',
      confidenceLevel: 'high',
      uncertaintyLevel: 'none',
      blockingCodes: [],
      uncertaintyFactors: [],
      missingData: [],
      legalRulesApplied: [{
        ruleId,
        playbookVersionId,
        branchId: null,
        citationRef: 'Art. 83, caput, CP — Pena mínima de 2 anos',
      }],
      calculations: [{
        name: 'Verificação de pena mínima',
        inputs: { penaTotalDias: totalDays, mínimoExigido: minSentenceDays },
        output: `Pena (${totalDays} dias) inferior ao mínimo de ${minSentenceDays} dias. Livramento não aplicável.`,
        confidence: 'high',
        derivationNote: 'Art. 83 do CP exige pena privativa de liberdade igual ou superior a 2 anos.',
      }],
    }
  }

  // ---- Calculate fraction ----
  const fractionalDaysNeeded = totalDays * requiredFraction
  const numerator = sentence.servedDays + sentence.remissionDays + sentence.detractionDays
  const eligible = numerator >= fractionalDaysNeeded
  const missingDays = Math.max(0, Math.ceil(fractionalDaysNeeded - numerator))

  const outputConfidence = sentence.confidenceLevel === 'high'
    ? 'high' as const
    : sentence.confidenceLevel === 'medium'
      ? 'medium' as const
      : 'low' as const

  // ---- Subjective requirement warnings ----
  const subjectiveWarnings: string[] = []
  if (requiresGoodBehavior) {
    subjectiveWarnings.push('Bom comportamento carcerário deve ser comprovado')
  }
  if (requiresCriminologicalExam) {
    subjectiveWarnings.push('Exame criminológico pode ser exigido judicialmente')
  }

  const calculations = [
    {
      name: 'Fração para livramento condicional',
      inputs: {
        penaTotalDias: totalDays,
        fração: `${(requiredFraction * 100).toFixed(2)}%`,
        diasNecessários: Math.ceil(fractionalDaysNeeded),
        diasCumpridos: sentence.servedDays,
        diasRemidos: sentence.remissionDays,
        diasDetração: sentence.detractionDays,
        totalNumerador: numerator,
      },
      output: eligible
        ? `ELEGÍVEL para livramento — cumpriu ${numerator}/${Math.ceil(fractionalDaysNeeded)} dias`
        : `NÃO ELEGÍVEL — faltam ${missingDays} dias (${numerator}/${Math.ceil(fractionalDaysNeeded)})`,
      confidence: outputConfidence,
      derivationNote: `Fração: ${(requiredFraction * 100).toFixed(2)}% da pena total. Parâmetros do playbook v${playbookVersionId}.`,
    },
    ...(subjectiveWarnings.length > 0 ? [{
      name: 'Requisitos subjetivos pendentes',
      inputs: { requisitos: subjectiveWarnings },
      output: `${subjectiveWarnings.length} requisito(s) subjetivo(s) pendente(s) de verificação`,
      confidence: 'medium' as const,
      derivationNote: 'Requisitos subjetivos do Art. 83 do CP não podem ser verificados automaticamente pelo motor.',
    }] : []),
  ]

  return {
    outcome: eligible ? 'opportunity_suggested' : 'no_match',
    confidenceLevel: outputConfidence,
    uncertaintyLevel: outputConfidence === 'high' ? 'none' : outputConfidence === 'medium' ? 'low' : 'medium',
    blockingCodes: [],
    uncertaintyFactors: sentence.confidenceLevel !== 'high' ? [{
      code: 'INCOMPLETE_RECORDS',
      message: `Confiança do snapshot: '${sentence.confidenceLevel}'`,
      affectedOutputs: ['parole_eligibility'],
    }] : [],
    missingData: sentence.missingDataFlags.map((f) => ({
      field: f.field,
      whyNeeded: f.description,
      severity: f.impact === 'high' ? 'critical' as const : 'recommended' as const,
    })),
    legalRulesApplied: [{
      ruleId,
      playbookVersionId,
      branchId: null,
      citationRef: 'Art. 83, CP c/c Art. 112, LEP',
    }],
    calculations,
    ...(eligible ? {
      opportunityProposal: {
        opportunityType: 'livramento',
        summary: `Livramento condicional — elegível (${((numerator / totalDays) * 100).toFixed(1)}% cumprido, limiar: ${(requiredFraction * 100).toFixed(1)}%)`,
        rationale: `Cumprido ${numerator} dias dos ${Math.ceil(fractionalDaysNeeded)} necessários (${(requiredFraction * 100).toFixed(2)}%). ${subjectiveWarnings.length > 0 ? 'Requisitos subjetivos pendentes de verificação.' : ''}`,
        windowStartAt: null,
        windowEndAt: null,
        riskLevel: 'high' as const,
        requiresLawyerReview: true,
      },
    } : {}),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blocked(codes: string[]): RuleEvaluatorOutput {
  return {
    outcome: 'opportunity_blocked',
    confidenceLevel: 'blocked',
    uncertaintyLevel: 'blocking',
    blockingCodes: codes,
    uncertaintyFactors: [],
    missingData: [],
    legalRulesApplied: [],
    calculations: [],
  }
}

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
