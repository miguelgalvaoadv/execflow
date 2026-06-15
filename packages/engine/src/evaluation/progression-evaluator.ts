import { randomUUID } from 'node:crypto'
import type { CaseLegalFacts } from '../types/legal-facts.js'
import type { BenefitEvaluation, CalculationResult, EligibilityAssessment, RationaleStep } from '../types/evaluators.js'
import { PlaybookRegistry } from '../playbooks/types.js'

export class ProgressionEvaluator {
  /**
   * Ponto de entrada puro.
   * Orquestra a injeção do Playbook e as 3 camadas internas.
   */
  evaluate(facts: CaseLegalFacts, playbookVersion: string, engineRunId: string): BenefitEvaluation {
    const playbook = PlaybookRegistry.get(playbookVersion)
    const rationale: RationaleStep[] = []

    rationale.push({
      code: 'START_PROGRESSION',
      title: 'Início da Avaliação de Progressão',
      description: `Utilizando Playbook ${playbook.name} (v${playbook.versionId})`
    })

    // CAMADA 1: Rule Resolver
    const rules = playbook.resolveProgressionRules(facts.sentences)
    rationale.push({
      code: 'RULES_RESOLVED',
      title: 'Regras Extraídas',
      description: `Resolvido ${rules.sentencesRules.length} regras individuais de condenação.`
    })

    // CAMADA 2: Calculator (Matemática Temporal Simples)
    // Para simplificar a arquitetura inicial, assumimos unificação em bloco.
    // Soma-se a proporção de cada pena: (Pena 1 * Fração 1) + (Pena 2 * Fração 2)
    let fractionalDaysNeeded = 0
    for (const rule of rules.sentencesRules) {
      const sentence = facts.sentences.find(s => s.id === rule.sentenceId)
      if (sentence) {
        fractionalDaysNeeded += (sentence.penaltyDays * rule.fraction)
      }
    }
    
    // Matemática pura
    const daysAlreadyServed = facts.penaltyTotals.executedPenaltyDays + facts.remissions.homologatedDays
    const missingDays = Math.max(0, fractionalDaysNeeded - daysAlreadyServed)
    
    const baseDate = facts.baselines.progressionBaseDate
    const projectedDate = new Date(baseDate.getTime() + (missingDays * 24 * 60 * 60 * 1000))

    const calculationResult: CalculationResult = {
      baseDate,
      projectedEligibilityDate: projectedDate,
      fractionalDaysNeeded,
      daysAlreadyServed,
      missingDays
    }

    rationale.push({
      code: 'CALCULATOR_DONE',
      title: 'Cálculo Temporal Finalizado',
      description: `Data base: ${baseDate.toISOString().split('T')[0]}. Faltam ${Math.ceil(missingDays)} dias.`
    })

    // CAMADA 3: Assessment
    // Para o Sprint 3, fazemos um mock simples: se a data chegou e não temos "atestado de conduta", bloqueamos.
    // Em um sistema real, leríamos uma flag de "bom_comportamento" de facts.incidents ou similar.
    const isDateReached = projectedDate.getTime() <= facts.evaluationDate.getTime()
    
    const assessment: EligibilityAssessment = {
      status: 'pending',
      blockingConditions: []
    }

    if (isDateReached) {
      // Mock blocker for architectural proof
      assessment.status = 'blocked'
      assessment.blockingConditions.push({
        code: 'MISSING_BEHAVIOR',
        category: 'behavioral',
        description: 'Não foi atestado o bom comportamento carcerário.',
        isOverridable: true
      })
    }

    rationale.push({
      code: 'ASSESSMENT_DONE',
      title: 'Análise de Aptidão',
      description: `Status: ${assessment.status}`
    })

    // Montando a Auditoria Final (BenefitEvaluation)
    return {
      evaluationId: randomUUID(),
      engineRunId,
      executionCaseId: facts.executionCaseId,
      evaluatedAt: new Date(), // Ponto exato da execução do motor (não confundir com evaluationDate temporal do fato)
      benefitType: 'progression',
      playbookVersion,
      ruleApplied: rules,
      calculationResult,
      eligibilityStatus: assessment,
      rationale
    }
  }
}
