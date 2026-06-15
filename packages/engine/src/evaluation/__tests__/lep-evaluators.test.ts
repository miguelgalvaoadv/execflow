/**
 * LEP Evaluators — Unit Tests
 *
 * Tests for the real LEP evaluators (progression, parole, remission, detraction).
 * Uses Node.js native test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { RuleEvaluatorInput, CaseFacts, SentenceFacts, CustodyFacts } from '../../types/index.ts'

// Import evaluator functions directly for unit testing
import { lepProgressionFractionEvaluator } from '../evaluators/lep-progression-evaluator.ts'
import { lepParoleFractionEvaluator } from '../evaluators/lep-parole-evaluator.ts'
import { lepRemissionEvaluator } from '../evaluators/lep-remission-evaluator.ts'
import { lepDetractionEvaluator } from '../evaluators/lep-detraction-evaluator.ts'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSentenceFacts(overrides: Partial<SentenceFacts> = {}): SentenceFacts {
  return {
    snapshotId: 'test-snapshot-001',
    effectiveAt: new Date('2024-01-01'),
    totalSentenceDays: 3650,
    servedDays: 600,
    remissionDays: 30,
    detractionDays: 60,
    remainingDays: 2960,
    percentServed: '16.44',
    confidenceLevel: 'high',
    missingDataFlags: [],
    playbookVersionId: 'V3_LEP_2019',
    ...overrides,
  }
}

function makeCustodyFacts(overrides: Partial<CustodyFacts> = {}): CustodyFacts {
  return {
    snapshotId: 'test-custody-001',
    effectiveAt: new Date('2024-01-01'),
    regime: 'fechado',
    prisonUnitId: null,
    confidence: 'high',
    ...overrides,
  }
}

function makeCaseFacts(overrides: Partial<CaseFacts> = {}): CaseFacts {
  return {
    organizationId: 'test-org',
    executionCaseId: 'test-case',
    evaluatedAt: new Date('2025-06-10'),
    sentence: makeSentenceFacts(),
    custody: makeCustodyFacts(),
    activeInterruptions: [],
    recentEvents: [],
    hasConfirmedProcessNumber: true,
    hasRecentConfirmedSnapshot: true,
    ...overrides,
  }
}

function makeInput(overrides: Partial<RuleEvaluatorInput> = {}): RuleEvaluatorInput {
  return {
    ruleId: 'test-rule',
    evaluatorId: 'test',
    parameters: {},
    facts: makeCaseFacts(),
    playbookVersionId: 'V3_LEP_2019',
    activeBlockingCodes: [],
    ...overrides,
  }
}

// ===========================================================================
// PROGRESSÃO DE REGIME
// ===========================================================================

describe('lepProgressionFractionEvaluator', () => {
  it('deve sugerir oportunidade quando fração 16% é atingida (crime comum primário)', () => {
    const input = makeInput({
      parameters: {
        defaultFraction: 0.16,
        targetRegime: 'semiaberto',
        denominatorBasis: 'pena_total',
      },
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({
          totalSentenceDays: 3650,
          servedDays: 600,
          remissionDays: 30,
          detractionDays: 60,
        }),
      }),
    })

    // 16% de 3650 = 584 dias necessários. Cumprido: 690. Elegível.
    const result = lepProgressionFractionEvaluator(input)

    assert.equal(result.outcome, 'opportunity_suggested')
    assert.equal(result.confidenceLevel, 'high')
    assert.ok(result.opportunityProposal !== undefined, 'deve ter proposal')
    assert.equal(result.opportunityProposal!.opportunityType, 'progression')
    assert.ok(result.calculations.length >= 3, 'deve ter pelo menos 3 cálculos')
    assert.equal(result.legalRulesApplied.length, 1)
  })

  it('deve retornar no_match quando fração 25% NÃO é atingida (hediondo primário)', () => {
    const input = makeInput({
      parameters: {
        defaultFraction: 0.25,
        targetRegime: 'semiaberto',
        denominatorBasis: 'pena_total',
      },
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({
          totalSentenceDays: 3650,
          servedDays: 500,
          remissionDays: 30,
          detractionDays: 60,
        }),
      }),
    })

    const result = lepProgressionFractionEvaluator(input)
    assert.equal(result.outcome, 'no_match')
    assert.equal(result.opportunityProposal, undefined)
  })

  it('deve calcular por crime quando fractionTable é fornecida', () => {
    const input = makeInput({
      parameters: {
        fractionTable: [
          { crimeCode: 'FURTO', crimeLabel: 'Furto', sentenceDays: 1825, fraction: 0.16, legalBasis: 'Art. 112, I, LEP' },
          { crimeCode: 'TRAFICO', crimeLabel: 'Tráfico', sentenceDays: 1825, fraction: 0.25, legalBasis: 'Art. 112, III, LEP' },
        ],
        targetRegime: 'semiaberto',
      },
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({
          totalSentenceDays: 3650,
          servedDays: 600,
          remissionDays: 30,
          detractionDays: 60,
        }),
      }),
    })

    const result = lepProgressionFractionEvaluator(input)
    // 16% de 1825 = 292 + 25% de 1825 = 456.25 → total: 748.25 necessários
    // Cumprido: 600 + 30 + 60 = 690 → NÃO elegível
    assert.equal(result.outcome, 'no_match')
    assert.equal(result.calculations.length, 3)
  })

  it('deve bloquear quando há fuga ativa', () => {
    const input = makeInput({
      parameters: { defaultFraction: 0.16 },
      activeBlockingCodes: ['BLK_ESCAPE'],
    })

    const result = lepProgressionFractionEvaluator(input)
    assert.equal(result.outcome, 'opportunity_blocked')
    assert.ok(result.blockingCodes.includes('BLK_ESCAPE'))
  })

  it('deve retornar insufficient_data quando snapshot é null', () => {
    const input = makeInput({
      parameters: { defaultFraction: 0.16 },
      facts: makeCaseFacts({ sentence: null }),
    })

    const result = lepProgressionFractionEvaluator(input)
    assert.equal(result.outcome, 'insufficient_data')
    assert.equal(result.missingData[0]!.field, 'sentence_snapshot')
  })

  it('deve bloquear quando há interrupção de progressão ativa', () => {
    const input = makeInput({
      parameters: { defaultFraction: 0.16 },
      facts: makeCaseFacts({
        activeInterruptions: [{
          type: 'progression',
          reason: 'Falta grave',
          since: new Date(),
          resetsAccrual: true,
          sourceEventId: null,
        }],
      }),
    })

    const result = lepProgressionFractionEvaluator(input)
    assert.equal(result.outcome, 'opportunity_blocked')
  })
})

// ===========================================================================
// LIVRAMENTO CONDICIONAL
// ===========================================================================

describe('lepParoleFractionEvaluator', () => {
  it('deve sugerir livramento quando 1/3 é atingido (primário comum)', () => {
    const input = makeInput({
      evaluatorId: 'lepParoleFraction',
      parameters: {
        requiredFraction: 1 / 3,
        requiresGoodBehavior: true,
        requiresCriminologicalExam: false,
        isProhibited: false,
      },
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({
          totalSentenceDays: 3650,
          servedDays: 1200,
          remissionDays: 30,
          detractionDays: 60,
        }),
      }),
    })

    const result = lepParoleFractionEvaluator(input)
    assert.equal(result.outcome, 'opportunity_suggested')
    assert.equal(result.opportunityProposal!.opportunityType, 'livramento')
  })

  it('deve vedar livramento para reincidente específico em hediondo', () => {
    const input = makeInput({
      evaluatorId: 'lepParoleFraction',
      parameters: {
        requiredFraction: 2 / 3,
        isProhibited: true,
      },
    })

    const result = lepParoleFractionEvaluator(input)
    assert.equal(result.outcome, 'opportunity_blocked')
    assert.ok(result.blockingCodes.includes('BLK_PAROLE_PROHIBITED'))
    assert.ok(result.legalRulesApplied[0]!.citationRef.includes('Art. 83, V, CP'))
  })

  it('deve recusar livramento quando pena < 2 anos', () => {
    const input = makeInput({
      evaluatorId: 'lepParoleFraction',
      parameters: {
        requiredFraction: 1 / 3,
        isProhibited: false,
      },
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({
          totalSentenceDays: 365,
          servedDays: 200,
        }),
      }),
    })

    const result = lepParoleFractionEvaluator(input)
    assert.equal(result.outcome, 'no_match')
  })
})

// ===========================================================================
// REMIÇÃO
// ===========================================================================

describe('lepRemissionEvaluator', () => {
  it('deve gerar oportunidade informacional quando há remição', () => {
    const input = makeInput({
      evaluatorId: 'lepRemission',
      parameters: {
        workRatio: 3,
        studyHoursPerDay: 12,
        readingDaysPerBook: 4,
        cumulationBonus: 1 / 3,
      },
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({
          remissionDays: 90,
        }),
      }),
    })

    const result = lepRemissionEvaluator(input)
    assert.equal(result.outcome, 'opportunity_suggested')
    assert.equal(result.opportunityProposal!.opportunityType, 'remission_impact')
    assert.equal(result.calculations.length, 2)
  })

  it('deve retornar no_match quando não há remição', () => {
    const input = makeInput({
      evaluatorId: 'lepRemission',
      parameters: {},
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({ remissionDays: 0 }),
      }),
    })

    const result = lepRemissionEvaluator(input)
    assert.equal(result.outcome, 'no_match')
  })
})

// ===========================================================================
// DETRAÇÃO
// ===========================================================================

describe('lepDetractionEvaluator', () => {
  it('deve gerar oportunidade quando há detração reconhecida', () => {
    const input = makeInput({
      evaluatorId: 'lepDetraction',
      parameters: { minDetractionDaysToReport: 1 },
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({
          detractionDays: 120,
        }),
      }),
    })

    const result = lepDetractionEvaluator(input)
    assert.equal(result.outcome, 'opportunity_suggested')
    assert.equal(result.opportunityProposal!.opportunityType, 'detraction')
    assert.ok(result.legalRulesApplied[0]!.citationRef.includes('Art. 42, CP'))
  })

  it('deve alertar quando não há detração registrada', () => {
    const input = makeInput({
      evaluatorId: 'lepDetraction',
      parameters: {},
      facts: makeCaseFacts({
        sentence: makeSentenceFacts({ detractionDays: 0 }),
      }),
    })

    const result = lepDetractionEvaluator(input)
    assert.equal(result.outcome, 'no_match')
    assert.ok(result.uncertaintyFactors.length > 0, 'deve ter alertas de incerteza')
    assert.ok(result.missingData.length > 0, 'deve ter dados faltantes')
  })
})
