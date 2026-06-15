import type { CrimeProfile, ResolvedRuleSet, SentenceRule } from '../types/evaluators.js'
import type { LegalSentence } from '../types/legal-facts.js'

export interface IPlaybook {
  readonly versionId: string
  readonly name: string

  resolveProgressionRules(sentences: LegalSentence[]): ResolvedRuleSet
  resolveParoleRules(sentences: LegalSentence[]): ResolvedRuleSet
}

export class PlaybookRegistry {
  private static playbooks = new Map<string, IPlaybook>()

  static register(playbook: IPlaybook): void {
    if (this.playbooks.has(playbook.versionId)) {
      throw new Error(`Playbook version ${playbook.versionId} is already registered.`)
    }
    this.playbooks.set(playbook.versionId, playbook)
  }

  static get(versionId: string): IPlaybook {
    const pb = this.playbooks.get(versionId)
    if (!pb) {
      throw new Error(`Playbook version ${versionId} not found in registry.`)
    }
    return pb
  }

  // Apenas para testes poderem resetar o estado estático
  static _clear(): void {
    this.playbooks.clear()
  }
}
