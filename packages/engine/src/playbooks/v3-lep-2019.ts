/**
 * Playbook V3 — LEP Pós-Pacote Anticrime (Lei 13.964/2019)
 *
 * Playbook real com todas as regras de progressão de regime, livramento
 * condicional, remição e detração conforme a legislação brasileira vigente.
 *
 * Este playbook é a implementação concreta das frações legais que antes
 * estavam apenas nos mocks V1/V2. Ele mapeia diretamente para os evaluators
 * LEP registrados no registry.
 *
 * ESTRUTURA:
 * - Grupo "progression": regras de progressão com branches por perfil criminal
 * - Grupo "parole": regras de livramento condicional
 * - Grupo "remission": regra de avaliação de impacto de remição
 * - Grupo "detraction": regra de detração penal
 * - Grupo "blocking": verificações de condições bloqueantes
 * - Grupo "staleness": verificação de snapshot desatualizado
 *
 * Architecture ref: playbook-system.md §2 (rule groups),
 *                   execution-engine.md §3 (legal computation rules).
 */

import type { IPlaybook } from './types.js'
import type { LegalSentence } from '../types/legal-facts.js'
import type { ResolvedRuleSet, SentenceRule } from '../types/evaluators.js'

/**
 * Playbook V3 — LEP 2019 (Pacote Anticrime)
 *
 * Resolve as frações corretas por crime com base no perfil criminal:
 * - Hediondez, equiparação, resultado morte
 * - Reincidência genérica vs. específica
 * - Liderança de organização criminosa armada
 */
export class PlaybookV3Lep2019 implements IPlaybook {
  readonly versionId = 'V3_LEP_2019'
  readonly name = 'LEP Pós-Pacote Anticrime (Lei 13.964/2019)'

  /**
   * Resolve as frações de progressão de regime por crime.
   * Art. 112, LEP (redação dada pela Lei 13.964/2019):
   *
   * I   — 16% → Comum, primário
   * II  — 20% → Comum, reincidente genérico
   * III — 25% → Hediondo/equiparado, primário, sem resultado morte
   * IV  — 30% → Hediondo/equiparado, primário, com resultado morte (tentado/consumado)
   * V   — 40% → Hediondo/equiparado, reincidente específico, sem resultado morte
   * VI  — 50% → Hediondo/equiparado, reincidente específico, com resultado morte
   * VII — 60% → Liderança de org. criminosa armada
   * VIII— 70% → Reincidente em liderança de org. criminosa armada com resultado morte
   */
  resolveProgressionRules(sentences: LegalSentence[]): ResolvedRuleSet {
    const rules: SentenceRule[] = sentences.map(s => {
      const profile = s.crimeProfile
      const fraction = this.resolveProgressionFraction(profile)

      return {
        sentenceId: s.id,
        fraction: fraction.value,
        legalBasis: fraction.legalBasis,
        law: fraction.law,
      }
    })

    return {
      sentencesRules: rules,
      requiresCriminologicalExam: sentences.some(s =>
        s.crimeProfile.isHeinous || s.crimeProfile.isEquatedHeinous
      ),
    }
  }

  /**
   * Resolve as frações de livramento condicional por crime.
   * Art. 83, CP:
   * - 1/3 → Comum, primário
   * - 1/2 → Comum, reincidente
   * - 2/3 → Hediondo/equiparado, primário
   * - VEDADO → Reincidente específico em hediondo
   */
  resolveParoleRules(sentences: LegalSentence[]): ResolvedRuleSet {
    const rules: SentenceRule[] = sentences.map(s => {
      const profile = s.crimeProfile
      const fraction = this.resolveParoleFraction(profile)

      return {
        sentenceId: s.id,
        fraction: fraction.value,
        legalBasis: fraction.legalBasis,
        law: fraction.law,
      }
    })

    return {
      sentencesRules: rules,
      requiresCriminologicalExam: sentences.some(s =>
        s.crimeProfile.isHeinous || s.crimeProfile.isEquatedHeinous || s.crimeProfile.hasDeathResult
      ),
    }
  }

  // ---------------------------------------------------------------------------
  // Fraction resolution (internal)
  // ---------------------------------------------------------------------------

  private resolveProgressionFraction(profile: LegalSentence['crimeProfile']): FractionResult {
    const isHeinousOrEquated = profile.isHeinous || profile.isEquatedHeinous

    // Art. 112, VII/VIII — Liderança de organização criminosa armada
    // (crimeCode convention: starts with 'ORG_CRIM_ARMADA')
    if (profile.crimeCode.startsWith('ORG_CRIM_ARMADA')) {
      if (profile.isSpecificRecidivist && profile.hasDeathResult) {
        return { value: 0.70, legalBasis: 'Art. 112, VIII, LEP', law: 'Lei 13.964/2019' }
      }
      return { value: 0.60, legalBasis: 'Art. 112, VII, LEP', law: 'Lei 13.964/2019' }
    }

    // Art. 112, V/VI — Hediondo, reincidente específico
    if (isHeinousOrEquated && profile.isSpecificRecidivist) {
      if (profile.hasDeathResult) {
        return { value: 0.50, legalBasis: 'Art. 112, VI, LEP', law: 'Lei 13.964/2019' }
      }
      return { value: 0.40, legalBasis: 'Art. 112, V, LEP', law: 'Lei 13.964/2019' }
    }

    // Art. 112, III/IV — Hediondo, primário
    if (isHeinousOrEquated) {
      if (profile.hasDeathResult) {
        return { value: 0.30, legalBasis: 'Art. 112, IV, LEP', law: 'Lei 13.964/2019' }
      }
      return { value: 0.25, legalBasis: 'Art. 112, III, LEP', law: 'Lei 13.964/2019' }
    }

    // Art. 112, II — Comum, reincidente genérico
    if (profile.isRecidivist) {
      return { value: 0.20, legalBasis: 'Art. 112, II, LEP', law: 'Lei 13.964/2019' }
    }

    // Art. 112, I — Comum, primário (default)
    return { value: 0.16, legalBasis: 'Art. 112, I, LEP', law: 'Lei 13.964/2019' }
  }

  private resolveParoleFraction(profile: LegalSentence['crimeProfile']): FractionResult {
    const isHeinousOrEquated = profile.isHeinous || profile.isEquatedHeinous

    // Art. 83, V, CP — Vedado para reincidente específico em hediondo
    if (isHeinousOrEquated && profile.isSpecificRecidivist) {
      return { value: -1, legalBasis: 'Art. 83, V, CP — VEDADO', law: 'CP (Decreto-Lei 2.848/40)' }
    }

    // Art. 83, V, CP — 2/3 para hediondo primário
    if (isHeinousOrEquated) {
      return { value: 2 / 3, legalBasis: 'Art. 83, V, CP', law: 'CP (Decreto-Lei 2.848/40)' }
    }

    // Art. 83, II, CP — 1/2 para reincidente comum
    if (profile.isRecidivist) {
      return { value: 1 / 2, legalBasis: 'Art. 83, II, CP', law: 'CP (Decreto-Lei 2.848/40)' }
    }

    // Art. 83, I, CP — 1/3 para primário comum
    return { value: 1 / 3, legalBasis: 'Art. 83, I, CP', law: 'CP (Decreto-Lei 2.848/40)' }
  }
}

type FractionResult = {
  value: number
  legalBasis: string
  law: string
}

/**
 * Rule groups for the ResolvedPlaybook format (used by the V7 engine pipeline).
 * This static structure is the canonical source for the LEP 2019 playbook rules.
 */
export const LEP_2019_RULE_GROUPS = {
  groups: [
    {
      groupId: 'lep-progression',
      label: 'Progressão de Regime (Art. 112, LEP)',
      rules: [
        {
          ruleId: 'lep-progression-common-primary',
          evaluatorId: 'lepProgressionFraction',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'lep-prog-16',
              label: 'Comum primário — 16%',
              isDefault: true,
              parameters: {
                defaultFraction: 0.16,
                targetRegime: 'semiaberto',
                denominatorBasis: 'pena_total',
              },
              legalReferences: ['Art. 112, I, LEP (Lei 13.964/2019)'],
            },
          ],
        },
        {
          ruleId: 'lep-progression-common-recidivist',
          evaluatorId: 'lepProgressionFraction',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'lep-prog-20',
              label: 'Comum reincidente — 20%',
              isDefault: true,
              parameters: {
                defaultFraction: 0.20,
                targetRegime: 'semiaberto',
                denominatorBasis: 'pena_total',
              },
              legalReferences: ['Art. 112, II, LEP (Lei 13.964/2019)'],
            },
          ],
        },
        {
          ruleId: 'lep-progression-heinous-primary',
          evaluatorId: 'lepProgressionFraction',
          cautionLevel: 'elevated' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'lep-prog-25',
              label: 'Hediondo primário s/ morte — 25%',
              isDefault: true,
              parameters: {
                defaultFraction: 0.25,
                targetRegime: 'semiaberto',
                denominatorBasis: 'pena_total',
              },
              legalReferences: ['Art. 112, III, LEP (Lei 13.964/2019)'],
            },
          ],
        },
        {
          ruleId: 'lep-progression-heinous-death',
          evaluatorId: 'lepProgressionFraction',
          cautionLevel: 'elevated' as const,
          requiresPartnerReview: true,
          branches: [
            {
              branchId: 'lep-prog-30',
              label: 'Hediondo primário c/ morte — 30%',
              isDefault: true,
              parameters: {
                defaultFraction: 0.30,
                targetRegime: 'semiaberto',
                denominatorBasis: 'pena_total',
              },
              legalReferences: ['Art. 112, IV, LEP (Lei 13.964/2019)'],
            },
          ],
        },
      ],
    },
    {
      groupId: 'lep-parole',
      label: 'Livramento Condicional (Art. 83, CP)',
      rules: [
        {
          ruleId: 'lep-parole-common-primary',
          evaluatorId: 'lepParoleFraction',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'lep-parole-1-3',
              label: 'Primário comum — 1/3',
              isDefault: true,
              parameters: {
                requiredFraction: 1 / 3,
                requiresGoodBehavior: true,
                requiresCriminologicalExam: false,
                isProhibited: false,
              },
              legalReferences: ['Art. 83, I, CP'],
            },
          ],
        },
        {
          ruleId: 'lep-parole-common-recidivist',
          evaluatorId: 'lepParoleFraction',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'lep-parole-1-2',
              label: 'Reincidente comum — 1/2',
              isDefault: true,
              parameters: {
                requiredFraction: 1 / 2,
                requiresGoodBehavior: true,
                requiresCriminologicalExam: false,
                isProhibited: false,
              },
              legalReferences: ['Art. 83, II, CP'],
            },
          ],
        },
        {
          ruleId: 'lep-parole-heinous-primary',
          evaluatorId: 'lepParoleFraction',
          cautionLevel: 'elevated' as const,
          requiresPartnerReview: true,
          branches: [
            {
              branchId: 'lep-parole-2-3',
              label: 'Hediondo primário — 2/3',
              isDefault: true,
              parameters: {
                requiredFraction: 2 / 3,
                requiresGoodBehavior: true,
                requiresCriminologicalExam: true,
                isProhibited: false,
              },
              legalReferences: ['Art. 83, V, CP'],
            },
          ],
        },
      ],
    },
    {
      groupId: 'lep-remission',
      label: 'Remição de Pena (Art. 126-130, LEP)',
      rules: [
        {
          ruleId: 'lep-remission-impact',
          evaluatorId: 'lepRemission',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'lep-remission-default',
              label: 'Avaliação de impacto de remição',
              isDefault: true,
              parameters: {
                workRatio: 3,
                studyHoursPerDay: 12,
                readingDaysPerBook: 4,
                cumulationBonus: 1 / 3,
              },
              legalReferences: ['Art. 126, LEP', 'Art. 126, §1º, LEP', 'Recomendação CNJ 44/2013'],
            },
          ],
        },
      ],
    },
    {
      groupId: 'lep-detraction',
      label: 'Detração Penal (Art. 42, CP)',
      rules: [
        {
          ruleId: 'lep-detraction-check',
          evaluatorId: 'lepDetraction',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'lep-detraction-default',
              label: 'Avaliação de detração',
              isDefault: true,
              parameters: {
                minDetractionDaysToReport: 1,
              },
              legalReferences: ['Art. 42, CP (Decreto-Lei 2.848/40)'],
            },
          ],
        },
      ],
    },
    {
      groupId: 'system-blocking',
      label: 'Condições Bloqueantes',
      rules: [
        {
          ruleId: 'system-escape-check',
          evaluatorId: 'blockingConditionCheck',
          cautionLevel: 'elevated' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'escape-block',
              label: 'Verificação de fuga ativa',
              isDefault: true,
              parameters: { blockingCode: 'BLK_ESCAPE' },
              legalReferences: ['Art. 50, II, LEP'],
            },
          ],
        },
      ],
    },
    {
      groupId: 'system-staleness',
      label: 'Atualidade do Snapshot',
      rules: [
        {
          ruleId: 'system-snapshot-staleness',
          evaluatorId: 'snapshotStalenessCheck',
          cautionLevel: 'elevated' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'staleness-180d',
              label: 'Snapshot > 180 dias',
              isDefault: true,
              parameters: { maxDays: 180 },
              legalReferences: [],
            },
          ],
        },
      ],
    },
  ],
}
