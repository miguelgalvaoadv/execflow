import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { extractLegalFacts, type SentenceSnapshotInput, type TimelineEventInput } from '../legal-fact-processor.js'

describe('LegalFactProcessor', () => {
  it('extracts basic facts without incidents', () => {
    const context = {
      executionCaseId: randomUUID(),
      evaluationDate: new Date('2024-01-01T00:00:00Z')
    }
    
    const snapshotCreatedAt = new Date('2023-01-01T00:00:00Z')
    const snapshot: SentenceSnapshotInput = {
      id: randomUUID(),
      crimesBreakdown: { crimes: [] },
      activeSentencesTotalDays: 3650,
      isGenericRecidivist: false,
      createdAt: snapshotCreatedAt
    }

    const events: TimelineEventInput[] = []

    const facts = extractLegalFacts(context, snapshot, events)

    assert.equal(facts.executionCaseId, context.executionCaseId)
    assert.equal(facts.evaluationDate, context.evaluationDate)
    assert.equal(facts.penaltyTotals.totalPenaltyDays, 3650)
    
    // As datas-base iniciais devem herdar o início do snapshot (ou data de prisão, a refinar)
    assert.equal(facts.baselines.progressionBaseDate.toISOString(), snapshotCreatedAt.toISOString())
    assert.equal(facts.baselines.paroleBaseDate.toISOString(), snapshotCreatedAt.toISOString())
    assert.equal(facts.incidents.length, 0)
  })

  it('severe_infraction resets progression base date but not parole', () => {
    const context = {
      executionCaseId: randomUUID(),
      evaluationDate: new Date('2024-01-01T00:00:00Z')
    }
    
    const snapshotCreatedAt = new Date('2022-01-01T00:00:00Z')
    const snapshot: SentenceSnapshotInput = {
      id: randomUUID(),
      crimesBreakdown: { crimes: [] },
      activeSentencesTotalDays: 3650,
      isGenericRecidivist: false,
      createdAt: snapshotCreatedAt
    }

    const infractionDate = new Date('2023-06-01T12:00:00Z')
    const events: TimelineEventInput[] = [
      {
        id: randomUUID(),
        eventType: 'infraction.severe',
        occurredAt: infractionDate,
        payload: {}
      }
    ]

    const facts = extractLegalFacts(context, snapshot, events)

    assert.equal(facts.incidents.length, 1)
    assert.equal(facts.incidents[0].type, 'severe_infraction')
    assert.ok(facts.incidents[0].impactsProgression)
    assert.equal(facts.incidents[0].impactsParole, false)

    // Data de progressão alterada para a infração (Súmula 534)
    assert.equal(facts.baselines.progressionBaseDate.toISOString(), infractionDate.toISOString())
    
    // Data de livramento mantida intocada (Súmula 441)
    assert.equal(facts.baselines.paroleBaseDate.toISOString(), snapshotCreatedAt.toISOString())
  })

  it('ignores events occurring strictly after evaluationDate', () => {
    const context = {
      executionCaseId: randomUUID(),
      evaluationDate: new Date('2023-01-01T00:00:00Z') // Data de corte antiga
    }
    
    const snapshotCreatedAt = new Date('2022-01-01T00:00:00Z')
    const snapshot: SentenceSnapshotInput = {
      id: randomUUID(),
      crimesBreakdown: { crimes: [] },
      activeSentencesTotalDays: 1000,
      isGenericRecidivist: false,
      createdAt: snapshotCreatedAt
    }

    const infractionDate = new Date('2024-01-01T00:00:00Z') // Aconteceu DEPOIS da data de corte
    const events: TimelineEventInput[] = [
      {
        id: randomUUID(),
        eventType: 'infraction.severe',
        occurredAt: infractionDate,
        payload: {}
      }
    ]

    const facts = extractLegalFacts(context, snapshot, events)

    // O evento deve ser ignorado para garantir replay
    assert.equal(facts.incidents.length, 0)
    assert.equal(facts.baselines.progressionBaseDate.toISOString(), snapshotCreatedAt.toISOString())
  })
})
