/**
 * Dependency tracker — records which inputs an EngineRun consumed.
 *
 * After evaluation, the runner records all dependencies so that:
 * - When a SentenceSnapshot is superseded → find affected runs → schedule recalculation
 * - When a PlaybookVersion is retired → find affected runs → schedule re-evaluation
 * - Replay: confirm the same dependencies are available at the historical instant
 *
 * Architecture ref: execution-engine.md §7 (historical replay),
 *                   Phase 7 snapshot_dependencies table.
 */

import type { CaseFacts, ResolvedPlaybook, EngineRunResult } from '../types/index.ts'

/**
 * Builds the dependency list from the facts and playbook used for an evaluation.
 * This list is persisted as snapshot_dependencies rows during the commit step.
 */
export function buildDependencies(
  facts: CaseFacts,
  playbook: ResolvedPlaybook
): EngineRunResult['dependencies'] {
  const deps: EngineRunResult['dependencies'] = []

  // Sentence snapshot dependency
  if (facts.sentence !== null) {
    deps.push({
      dependencyType: 'sentence_snapshot',
      dependencyEntityId: facts.sentence.snapshotId,
      dependencyEffectiveAt: facts.sentence.effectiveAt,
      dependencyVersion: facts.sentence.confidenceLevel,
    })
  }

  // Custody snapshot dependency
  if (facts.custody !== null) {
    deps.push({
      dependencyType: 'custody_snapshot',
      dependencyEntityId: facts.custody.snapshotId,
      dependencyEffectiveAt: facts.custody.effectiveAt,
      dependencyVersion: facts.custody.confidence,
    })
  }

  // Timeline event dependencies (most recent events used in evaluation)
  for (const event of facts.recentEvents) {
    deps.push({
      dependencyType: 'timeline_event',
      dependencyEntityId: event.eventId,
      dependencyEffectiveAt: event.occurredAt,
      dependencyVersion: null,
    })
  }

  // Playbook version dependency
  deps.push({
    dependencyType: 'playbook_version',
    dependencyEntityId: playbook.playbookVersionId,
    dependencyEffectiveAt: playbook.effectiveAt,
    dependencyVersion: null,
  })

  // Overlay version dependency
  if (playbook.overlayVersionId !== null) {
    deps.push({
      dependencyType: 'playbook_version',
      dependencyEntityId: playbook.overlayVersionId,
      dependencyEffectiveAt: playbook.effectiveAt,
      dependencyVersion: null,
    })
  }

  return deps
}
