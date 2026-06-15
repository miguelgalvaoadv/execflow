import type { IPlaybook } from './types.js'
import type { LegalSentence } from '../types/legal-facts.js'
import type { ResolvedRuleSet, SentenceRule } from '../types/evaluators.js'

export class PlaybookV1Mock implements IPlaybook {
  readonly versionId = 'V1_MOCK'
  readonly name = 'Mock V1 (Progression = 1/6 for all)'

  resolveProgressionRules(sentences: LegalSentence[]): ResolvedRuleSet {
    const rules: SentenceRule[] = sentences.map(s => ({
      sentenceId: s.id,
      fraction: 1 / 6,
      legalBasis: 'Mock Rule V1',
      law: 'Mock Law'
    }))

    return {
      sentencesRules: rules,
      requiresCriminologicalExam: false
    }
  }

  resolveParoleRules(sentences: LegalSentence[]): ResolvedRuleSet {
    return { sentencesRules: [], requiresCriminologicalExam: false }
  }
}
