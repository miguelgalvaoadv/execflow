/**
 * LEP Progression Evaluator — Progressão de Regime Penal
 *
 * Implementa o cálculo de progressão de regime baseado nas frações
 * da Lei de Execução Penal (LEP - Lei 7.210/84) com as alterações
 * do Pacote Anticrime (Lei 13.964/2019).
 *
 * FRAÇÕES DE PROGRESSÃO (Art. 112, LEP pós-2019):
 * I   — 16% → Crime comum, primário
 * II  — 20% → Crime comum, reincidente genérico (ou primário c/ falta grave últimos 12m)
 * III — 25% → Crime hediondo/equiparado, primário, SEM resultado morte
 * IV  — 30% → Crime hediondo/equiparado, primário, COM resultado morte (tentado ou consumado)
 * V   — 40% → Crime hediondo/equiparado, reincidente específico, SEM resultado morte
 * VI  — 50% → Crime hediondo/equiparado, reincidente específico, COM resultado morte
 * VII — 60% → Liderança de org. criminosa armada (Art. 2º, §9º, Lei 12.850/13)
 * VIII— 70% → Reincidente em liderança de org. criminosa armada COM resultado morte
 *
 * PRINCÍPIOS:
 * - Nenhuma fração é hardcoded no evaluator; todas vêm como parâmetros do playbook
 * - O evaluator recebe CaseFacts com crimesBreakdown e calcula POR CRIME
 * - Soma proporcional: (Pena1 × Fração1) + (Pena2 × Fração2) = total de dias necessários
 * - Remição e detração entram como abatimento no numerador
 *
 * Architecture ref: execution-engine.md §3.1 (progression engine),
 *                   playbook-system.md §9 (forbidden hardcoded fractions).
 */

import type { RuleEvaluatorInput, RuleEvaluatorOutput } from '../../types/index.ts'

/**
 * Evaluator puro de progressão de regime LEP.
 * Registrado no registry com id 'lepProgressionFraction'.
 */
export function lepProgressionFractionEvaluator(input: RuleEvaluatorInput): RuleEvaluatorOutput {
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
    return insufficientData('sentence_snapshot', 'Snapshot de sentença confirmado é necessário para cálculo de progressão')
  }

  if (facts.custody === null) {
    return insufficientData('custody_snapshot', 'Snapshot de custódia confirmado é necessário para determinar regime atual')
  }

  // ---- Check active progression interruptions ----
  const interruptions = facts.activeInterruptions.filter(
    (i) => i.type === 'progression' || i.type === 'all_liberty'
  )
  if (interruptions.length > 0) {
    return {
      outcome: 'opportunity_blocked',
      confidenceLevel: 'blocked',
      uncertaintyLevel: 'high',
      blockingCodes: ['BLK_INTERRUPTION_ACTIVE'],
      uncertaintyFactors: [{
        code: 'PENDING_JUDICIAL_DECISION',
        message: `Interrupção de progressão ativa: ${interruptions[0]?.reason ?? 'não especificado'}`,
        affectedOutputs: ['progression_eligibility'],
      }],
      missingData: [],
      legalRulesApplied: [],
      calculations: [],
    }
  }

  // ---- Extract playbook parameters (NEVER hardcoded) ----
  const fractionTable = parameters['fractionTable'] as FractionTableEntry[] | undefined
  const defaultFraction = parameters['defaultFraction'] as number | undefined
  const targetRegime = parameters['targetRegime'] as string | undefined ?? 'semiaberto'
  const denominatorBasis = parameters['denominatorBasis'] as string | undefined ?? 'pena_total'

  if (fractionTable === undefined && defaultFraction === undefined) {
    return insufficientData(
      'playbook_parameters',
      'fractionTable ou defaultFraction devem estar configurados no playbook para progressão LEP'
    )
  }

  const sentence = facts.sentence
  const totalDays = sentence.totalSentenceDays

  if (totalDays <= 0) {
    return insufficientData('total_sentence_days', 'Pena total em dias deve ser > 0')
  }

  // ---- Calculate fractional days needed per crime ----
  // Se temos fractionTable, calculamos por crime individual
  // Senão, usamos a defaultFraction sobre toda a pena
  let fractionalDaysNeeded: number
  const calculationSteps: CalculationStep[] = []

  if (fractionTable !== undefined && fractionTable.length > 0) {
    fractionalDaysNeeded = 0

    for (const entry of fractionTable) {
      const daysForThisCrime = entry.sentenceDays * entry.fraction
      fractionalDaysNeeded += daysForThisCrime

      calculationSteps.push({
        crime: entry.crimeLabel ?? entry.crimeCode ?? 'N/A',
        sentenceDays: entry.sentenceDays,
        fraction: entry.fraction,
        fractionLabel: entry.fractionLabel ?? `${(entry.fraction * 100).toFixed(0)}%`,
        legalBasis: entry.legalBasis ?? 'Art. 112, LEP',
        daysNeeded: Math.ceil(daysForThisCrime),
      })
    }
  } else {
    const fraction = defaultFraction!
    fractionalDaysNeeded = totalDays * fraction

    calculationSteps.push({
      crime: 'Pena unificada',
      sentenceDays: totalDays,
      fraction,
      fractionLabel: `${(fraction * 100).toFixed(0)}%`,
      legalBasis: 'Art. 112, LEP',
      daysNeeded: Math.ceil(fractionalDaysNeeded),
    })
  }

  // ---- Compute numerator: served + remission + detraction ----
  const numerator = sentence.servedDays + sentence.remissionDays + sentence.detractionDays
  const eligible = numerator >= fractionalDaysNeeded
  const missingDays = Math.max(0, Math.ceil(fractionalDaysNeeded - numerator))

  // ---- Propagate confidence from snapshot ----
  const outputConfidence = sentence.confidenceLevel === 'high'
    ? 'high' as const
    : sentence.confidenceLevel === 'medium'
      ? 'medium' as const
      : 'low' as const

  // ---- Build calculation details for ExplanationBundle ----
  const calculations = [
    {
      name: 'Dias necessários para progressão (por crime)',
      inputs: {
        crimes: calculationSteps.map((s) => ({
          crime: s.crime,
          penaDias: s.sentenceDays,
          fração: s.fractionLabel,
          fundamentoLegal: s.legalBasis,
          diasNecessários: s.daysNeeded,
        })),
        totalDiasNecessários: Math.ceil(fractionalDaysNeeded),
      },
      output: `${Math.ceil(fractionalDaysNeeded)} dias necessários`,
      confidence: outputConfidence,
      derivationNote: `Soma ponderada: Σ(pena_crime × fração_crime). Cada fração vem do playbook v${playbookVersionId}.`,
    },
    {
      name: 'Tempo já cumprido (numerador)',
      inputs: {
        diasCumpridos: sentence.servedDays,
        diasRemidos: sentence.remissionDays,
        diasDetração: sentence.detractionDays,
        totalNumerador: numerator,
      },
      output: `${numerator} dias cumpridos (efetivos + remição + detração)`,
      confidence: outputConfidence,
      derivationNote: `Numerador = dias cumpridos + remição homologada + detração reconhecida.`,
    },
    {
      name: 'Resultado da elegibilidade',
      inputs: {
        numerador: numerator,
        denominador: Math.ceil(fractionalDaysNeeded),
        porcentagemCumprida: totalDays > 0 ? `${((numerator / totalDays) * 100).toFixed(2)}%` : 'N/A',
        diasFaltantes: missingDays,
      },
      output: eligible
        ? `ELEGÍVEL — já cumpriu ${numerator} dias (necessários: ${Math.ceil(fractionalDaysNeeded)})`
        : `NÃO ELEGÍVEL — faltam ${missingDays} dias (cumpriu ${numerator}/${Math.ceil(fractionalDaysNeeded)})`,
      confidence: outputConfidence,
      derivationNote: `Comparação: numerador (${numerator}) ${eligible ? '≥' : '<'} dias necessários (${Math.ceil(fractionalDaysNeeded)}).`,
    },
  ]

  return {
    outcome: eligible ? 'opportunity_suggested' : 'no_match',
    confidenceLevel: outputConfidence,
    uncertaintyLevel: outputConfidence === 'high' ? 'none' : outputConfidence === 'medium' ? 'low' : 'medium',
    blockingCodes: [],
    uncertaintyFactors: sentence.confidenceLevel !== 'high' ? [{
      code: 'INCOMPLETE_RECORDS',
      message: `Confiança do snapshot de sentença: '${sentence.confidenceLevel}' — cálculo pode ser impreciso`,
      affectedOutputs: ['fraction_served', 'eligibility_date'],
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
      citationRef: 'Art. 112, LEP (Lei 7.210/84) c/c Lei 13.964/2019',
    }],
    calculations,
    ...(eligible ? {
      opportunityProposal: {
        opportunityType: 'progression',
        summary: `Progressão para regime ${targetRegime} — elegível (${((numerator / totalDays) * 100).toFixed(1)}% cumprido)`,
        rationale: `Cumprido ${numerator} dias (incluindo remição e detração) dos ${Math.ceil(fractionalDaysNeeded)} necessários para progressão. Fração calculada individualmente por crime conforme Art. 112, LEP.`,
        windowStartAt: null,
        windowEndAt: null,
        riskLevel: 'high' as const,
        requiresLawyerReview: true,
      },
    } : {}),
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type FractionTableEntry = {
  crimeCode?: string
  crimeLabel?: string
  sentenceDays: number
  fraction: number
  fractionLabel?: string
  legalBasis?: string
}

type CalculationStep = {
  crime: string
  sentenceDays: number
  fraction: number
  fractionLabel: string
  legalBasis: string
  daysNeeded: number
}

// ---------------------------------------------------------------------------
// Helper factories for common return shapes
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
