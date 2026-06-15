import type { CaseLegalFacts, LegalSentence, LegalIncident, RegimePeriod, CrimeProfile } from '../types/legal-facts.js'

export interface LegalFactProcessorContext {
  executionCaseId: string
  evaluationDate: Date
}

// Interfaces mínimas para desacoplar parcialmente do Drizzle schema se desejado,
// ou simplesmente re-exportar os tipos do db. Usaremos um formato DTO-like para os inputs.
export interface SentenceSnapshotInput {
  id: string
  crimesBreakdown: { crimes: CrimeBreakdownItem[] }
  activeSentencesTotalDays: number
  isGenericRecidivist: boolean
  createdAt: Date
}

export interface CrimeBreakdownItem {
  crimeCode: string
  crimeName: string
  article: string
  law: string
  sentenceDays: number
  isHediondo: boolean
  isEquiparado: boolean
  hasResultingDeath: boolean
  isAttempted: boolean
  sentenceDate: string
  transitDate: string
}

export interface TimelineEventInput {
  id: string
  eventType: string
  occurredAt: Date
  payload: Record<string, any>
}

export function extractLegalFacts(
  context: LegalFactProcessorContext,
  snapshot: SentenceSnapshotInput,
  events: TimelineEventInput[]
): CaseLegalFacts {
  // 1. Filtrar eventos estritamente <= evaluationDate
  const cutoffTime = context.evaluationDate.getTime()
  const validEvents = events
    .filter(e => e.occurredAt.getTime() <= cutoffTime)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  // 2. Extrair sentenças do crimesBreakdown
  const sentences: LegalSentence[] = extractSentencesFromBreakdown(
    snapshot.id,
    snapshot.crimesBreakdown?.crimes ?? [],
    snapshot.isGenericRecidivist
  )

  // 3. Inicializar os fatos base
  const facts: CaseLegalFacts = {
    executionCaseId: context.executionCaseId,
    evaluationDate: context.evaluationDate,
    sentences,
    penaltyTotals: {
      totalPenaltyDays: snapshot.activeSentencesTotalDays || 0,
      executedPenaltyDays: 0,
      remainingPenaltyDays: snapshot.activeSentencesTotalDays || 0
    },
    remissions: {
      homologatedDays: 0,
      pendingDays: 0
    },
    detractionDays: 0,
    baselines: {
      progressionBaseDate: snapshot.createdAt,
      paroleBaseDate: snapshot.createdAt,
      pardonBaseDate: snapshot.createdAt
    },
    regimeHistory: [],
    currentRegime: 'closed', // default inicial
    isCurrentlyIncarcerated: true,
    incidents: [],
    warnings: [],
    eligibilityInputs: {
      applicableCrimeProfiles: sentences.map(s => s.crimeProfile),
      requiresCriminologicalExam: sentences.some(s =>
        s.crimeProfile.isHeinous || s.crimeProfile.isEquatedHeinous || s.crimeProfile.hasDeathResult
      )
    }
  }

  // 4. Reducer Temporal dos eventos — percorrer em ordem cronológica
  for (const event of validEvents) {
    processEvent(facts, event)
  }

  // 5. Calcular dias cumpridos com base no tempo desde a data-base
  const progressionBaseDateMs = facts.baselines.progressionBaseDate.getTime()
  const evaluationDateMs = context.evaluationDate.getTime()
  const daysSinceBase = Math.floor((evaluationDateMs - progressionBaseDateMs) / (1000 * 60 * 60 * 24))
  facts.penaltyTotals.executedPenaltyDays = Math.max(0, daysSinceBase)
  facts.penaltyTotals.remainingPenaltyDays = Math.max(
    0,
    facts.penaltyTotals.totalPenaltyDays - facts.penaltyTotals.executedPenaltyDays - facts.remissions.homologatedDays - facts.detractionDays
  )

  return facts
}

// ---------------------------------------------------------------------------
// Event processors
// ---------------------------------------------------------------------------

function processEvent(facts: CaseLegalFacts, event: TimelineEventInput): void {
  const eventType = event.eventType

  // Falta grave homologada — reinicia data-base de progressão
  if (eventType === 'infraction.severe' || eventType === 'disciplinary.falta_grave.homologada') {
    facts.baselines.progressionBaseDate = event.occurredAt
    facts.incidents.push({
      type: 'severe_infraction',
      date: event.occurredAt,
      sourceEventId: event.id,
      impactsProgression: true,
      impactsParole: false // falta grave NÃO reinicia data-base de livramento (Súmula 441 STJ)
    })
    return
  }

  // Fuga — interrupção total de liberdade
  if (eventType === 'custody.escape' || eventType === 'escape') {
    facts.incidents.push({
      type: 'escape',
      date: event.occurredAt,
      sourceEventId: event.id,
      impactsProgression: true,
      impactsParole: true
    })
    facts.isCurrentlyIncarcerated = false
    return
  }

  // Recaptura — encerra interrupção de fuga
  if (eventType === 'custody.recapture' || eventType === 'recapture') {
    facts.incidents.push({
      type: 'recapture',
      date: event.occurredAt,
      sourceEventId: event.id,
      impactsProgression: true,
      impactsParole: true
    })
    // Reinicia data-base após fuga + recaptura
    facts.baselines.progressionBaseDate = event.occurredAt
    facts.baselines.paroleBaseDate = event.occurredAt
    facts.isCurrentlyIncarcerated = true
    return
  }

  // Progressão de regime
  if (eventType === 'regime.progression' || eventType === 'custody.regime_change') {
    const newRegime = event.payload['newRegime'] as string | undefined
    const mappedRegime = mapRegime(newRegime)

    // Fechar período atual
    const currentPeriod = facts.regimeHistory.find(p => p.isCurrent)
    if (currentPeriod) {
      currentPeriod.endDate = event.occurredAt
      currentPeriod.isCurrent = false
    }

    // Abrir novo período
    facts.regimeHistory.push({
      regime: mappedRegime,
      startDate: event.occurredAt,
      endDate: null,
      isCurrent: true,
      reason: 'progression'
    })
    facts.currentRegime = mappedRegime
    return
  }

  // Regressão de regime
  if (eventType === 'regime.regression') {
    const newRegime = event.payload['newRegime'] as string | undefined
    const mappedRegime = mapRegime(newRegime)

    const currentPeriod = facts.regimeHistory.find(p => p.isCurrent)
    if (currentPeriod) {
      currentPeriod.endDate = event.occurredAt
      currentPeriod.isCurrent = false
    }

    facts.regimeHistory.push({
      regime: mappedRegime,
      startDate: event.occurredAt,
      endDate: null,
      isCurrent: true,
      reason: 'regression'
    })
    facts.currentRegime = mappedRegime
    facts.incidents.push({
      type: 'regime_regression',
      date: event.occurredAt,
      sourceEventId: event.id,
      impactsProgression: true,
      impactsParole: false
    })
    return
  }

  // Remição homologada
  if (eventType === 'remission.homologated' || eventType === 'remission.work' || eventType === 'remission.study') {
    const days = event.payload['days'] as number | undefined ?? 0
    facts.remissions.homologatedDays += days
    return
  }

  // Remição pendente
  if (eventType === 'remission.pending') {
    const days = event.payload['days'] as number | undefined ?? 0
    facts.remissions.pendingDays += days
    return
  }

  // Detração reconhecida
  if (eventType === 'detraction.recognized' || eventType === 'detraction.computed') {
    const days = event.payload['days'] as number | undefined ?? 0
    facts.detractionDays += days
    return
  }

  // Nova condenação (unificação)
  if (eventType === 'conviction.new') {
    facts.incidents.push({
      type: 'new_conviction',
      date: event.occurredAt,
      sourceEventId: event.id,
      impactsProgression: true,
      impactsParole: true
    })
    facts.warnings.push({
      code: 'WARN_NEW_CONVICTION',
      severity: 'warning',
      message: `Nova condenação registrada em ${event.occurredAt.toISOString().split('T')[0]} — possível necessidade de unificação de penas.`
    })
    return
  }
}

// ---------------------------------------------------------------------------
// Crime breakdown extraction
// ---------------------------------------------------------------------------

function extractSentencesFromBreakdown(
  snapshotId: string,
  crimes: CrimeBreakdownItem[],
  isGenericRecidivist: boolean
): LegalSentence[] {
  return crimes.map((crime, index) => ({
    id: `${snapshotId}-crime-${index}`,
    sourceSnapshotId: snapshotId,
    penaltyDays: crime.sentenceDays,
    crimeDate: new Date(crime.sentenceDate || crime.transitDate || new Date().toISOString()),
    crimeProfile: {
      crimeCode: crime.crimeCode || `CRIME_${index}`,
      article: crime.article || '',
      law: crime.law || '',
      isHeinous: crime.isHediondo ?? false,
      isEquatedHeinous: crime.isEquiparado ?? false,
      hasDeathResult: crime.hasResultingDeath ?? false,
      isPrimary: !isGenericRecidivist,
      isRecidivist: isGenericRecidivist,
      isSpecificRecidivist: false, // Specific recidivism must be manually set per case
    },
  }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRegime(regime: string | undefined): 'closed' | 'semi_open' | 'open' {
  if (!regime) return 'closed'
  const lower = regime.toLowerCase()
  if (lower.includes('aberto') || lower === 'open') return 'open'
  if (lower.includes('semi') || lower === 'semi_open' || lower === 'semiaberto') return 'semi_open'
  return 'closed'
}

