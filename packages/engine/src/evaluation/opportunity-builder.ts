import { randomUUID } from 'node:crypto'
import type { AnyDbClient } from '@execflow/db/client'
import { opportunities } from '@execflow/db/schema'
import type { BenefitEvaluation } from '../types/evaluators.js'

export class OpportunityBuilder {
  /**
   * Converte uma avaliação em memória para uma oportunidade persistida no banco.
   * Representa o fim do pipeline de cálculo determinístico e o início do workflow humano.
   */
  async persistOpportunity(
    db: AnyDbClient,
    evaluation: BenefitEvaluation,
    organizationId: string
  ): Promise<string> {
    const isBlocked = evaluation.eligibilityStatus.status === 'blocked'
    const status = isBlocked ? 'dismissed' : 'suggested'

    const rationaleText = evaluation.rationale
      .map((r) => `[${r.code}] ${r.title}: ${r.description}`)
      .join('\n')

    // Formata o resumo
    let summary = `Avaliação de ${evaluation.benefitType} via playbook ${evaluation.playbookVersion}.`
    if (evaluation.calculationResult) {
      summary += ` Data-base: ${evaluation.calculationResult.baseDate.toISOString().split('T')[0]}.`
      summary += ` Data projetada: ${evaluation.calculationResult.projectedEligibilityDate.toISOString().split('T')[0]}.`
    }

    if (isBlocked) {
      summary = `[BLOQUEADA] ${summary}`
    }

    const [inserted] = await db
      .insert(opportunities)
      .values({
        id: randomUUID(),
        organizationId,
        executionCaseId: evaluation.executionCaseId,
        opportunityType: evaluation.benefitType,
        status,
        detectedAt: new Date(),
        summary,
        rationale: rationaleText,
        windowStartAt: evaluation.calculationResult?.projectedEligibilityDate ?? null,
        windowEndAt: null,
        confidenceLevel: 'high',
        requiresReview: true,
        playbookVersionId: evaluation.playbookVersion,
      })
      .returning({ id: opportunities.id })

    if (!inserted) {
      throw new Error('Falha ao persistir a oportunidade no banco.')
    }

    return inserted.id
  }
}
