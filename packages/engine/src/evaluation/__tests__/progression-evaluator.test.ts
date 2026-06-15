import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ProgressionEvaluator } from '../progression-evaluator.js'
import { PlaybookRegistry } from '../../playbooks/types.js'
import { PlaybookV1Mock } from '../../playbooks/v1-mock.js'
import { PlaybookV2Mock } from '../../playbooks/v2-mock.js'
import type { CaseLegalFacts } from '../../types/legal-facts.js'

describe('ProgressionEvaluator (Arquitetural)', () => {
  before(() => {
    PlaybookRegistry._clear()
    PlaybookRegistry.register(new PlaybookV1Mock())
    PlaybookRegistry.register(new PlaybookV2Mock())
  })

  const createMockFacts = (isHeinous: boolean): CaseLegalFacts => {
    const baseDate = new Date('2023-01-01T00:00:00Z')
    return {
      executionCaseId: randomUUID(),
      evaluationDate: new Date('2025-01-01T00:00:00Z'),
      sentences: [
        {
          id: randomUUID(),
          sourceSnapshotId: randomUUID(),
          penaltyDays: 3650, // 10 anos
          crimeDate: new Date('2022-01-01T00:00:00Z'),
          crimeProfile: {
            crimeCode: 'MOCK',
            article: 'Mock',
            law: 'Mock',
            isHeinous,
            isEquatedHeinous: false,
            hasDeathResult: false,
            isPrimary: true,
            isRecidivist: false,
            isSpecificRecidivist: false
          }
        }
      ],
      penaltyTotals: {
        totalPenaltyDays: 3650,
        executedPenaltyDays: 0,
        remainingPenaltyDays: 3650
      },
      remissions: { homologatedDays: 0, pendingDays: 0 },
      baselines: {
        progressionBaseDate: baseDate,
        paroleBaseDate: baseDate,
        pardonBaseDate: baseDate
      },
      regimeHistory: [],
      currentRegime: 'closed',
      isCurrentlyIncarcerated: true,
      incidents: [],
      warnings: [],
      eligibilityInputs: { applicableCrimeProfiles: [], requiresCriminologicalExam: false }
    }
  }

  it('prova troca de Playbook alterando o resultado sem tocar no Evaluator', () => {
    const evaluator = new ProgressionEvaluator()
    const engineRunId = randomUUID()
    
    // Fatos: 1 crime hediondo.
    const facts = createMockFacts(true)

    // Avaliação usando Playbook V1 (1/6 para todos)
    const resultV1 = evaluator.evaluate(facts, 'V1_MOCK', engineRunId)
    // 3650 * (1/6) = ~608 dias
    assert.equal(Math.floor(resultV1.calculationResult.fractionalDaysNeeded), 608)
    
    // Troca quente de Legislação: Playbook V2 (40% para hediondos)
    const resultV2 = evaluator.evaluate(facts, 'V2_MOCK', engineRunId)
    // 3650 * 0.40 = 1460 dias
    assert.equal(resultV2.calculationResult.fractionalDaysNeeded, 1460)

    // O Evaluator não sofreu alteração, apenas a injeção do Strategy mudou o Output
    assert.notEqual(resultV1.calculationResult.projectedEligibilityDate.getTime(), resultV2.calculationResult.projectedEligibilityDate.getTime())
  })

  it('prova replay determinístico (mesmo input = mesmo output estrutural)', () => {
    const evaluator = new ProgressionEvaluator()
    const engineRunId = randomUUID()
    const facts = createMockFacts(false) // Comum

    const resultA = evaluator.evaluate(facts, 'V1_MOCK', engineRunId)
    const resultB = evaluator.evaluate(facts, 'V1_MOCK', engineRunId)

    // Asserção garantindo que a matemática temporal (projectedEligibilityDate) é idêntica
    assert.equal(
      resultA.calculationResult.projectedEligibilityDate.getTime(),
      resultB.calculationResult.projectedEligibilityDate.getTime()
    )
    
    // Apenas os metadados de execução (id/timestamp) mudam
    assert.notEqual(resultA.evaluationId, resultB.evaluationId)
  })

  it('assessment isola aptidão administrativa', () => {
    const evaluator = new ProgressionEvaluator()
    const facts = createMockFacts(false) // Comum, 1/6 (608 dias)
    
    // Data base = 2023-01-01. Data alcançada: aprox. Ago/2024.
    // Data de avaliação injetada: 2025-01-01 (portanto, data já atingida)
    
    const result = evaluator.evaluate(facts, 'V1_MOCK', randomUUID())

    // A data temporal é no passado
    assert.ok(result.calculationResult.projectedEligibilityDate.getTime() < facts.evaluationDate.getTime())
    
    // Apesar de atingir o requisito objetivo (tempo), o status é blocked por falta de requisito subjetivo (mock behavior)
    assert.equal(result.eligibilityStatus.status, 'blocked')
    assert.equal(result.eligibilityStatus.blockingConditions[0].code, 'MISSING_BEHAVIOR')
  })
})
