import type { IPlaybook } from './types.js'
import type { LegalSentence } from '../types/legal-facts.js'
import type { ResolvedRuleSet, SentenceRule } from '../types/evaluators.js'

export class PlaybookV2Mock implements IPlaybook {
  readonly versionId = 'V2_MOCK'
  readonly name = 'Mock V2 (Progression = 40% for heinous, 1/6 for others)'

  resolveProgressionRules(sentences: LegalSentence[]): ResolvedRuleSet {
    const rules: SentenceRule[] = sentences.map(s => {
      const isHeinous = s.crimeProfile.isHeinous
      return {
        sentenceId: s.id,
        fraction: isHeinous ? 0.40 : (1 / 6),
        legalBasis: isHeinous ? 'Mock Rule V2 (Heinous)' : 'Mock Rule V2 (Common)',
        law: 'Mock Law V2'
      }
    })

    return {
      sentencesRules: rules,
      requiresCriminologicalExam: false
    }
  }

  resolveParoleRules(sentences: LegalSentence[]): ResolvedRuleSet {
    return { sentencesRules: [], requiresCriminologicalExam: false }
  }
}
