export interface CaseLegalFacts {
  executionCaseId: string
  evaluationDate: Date

  // O Cenário Estático da Pena (Matemática Absoluta)
  sentences: LegalSentence[]
  penaltyTotals: PenaltyTotals
  
  // O Cenário de Remição (Direito Premial)
  remissions: RemissionFacts
  
  // Detração (Art. 42, CP) — prisão provisória descontada
  detractionDays: number
  
  // As Datas-Base Independentes
  baselines: {
    progressionBaseDate: Date
    paroleBaseDate: Date
    pardonBaseDate: Date
  }

  // Histórico e Status de Regimes
  regimeHistory: RegimePeriod[]
  currentRegime: 'closed' | 'semi_open' | 'open'
  isCurrentlyIncarcerated: boolean
  
  // Histórico de Interrupções e Fatos Relevantes
  incidents: LegalIncident[]
  
  // Camada de Qualidade de Dados
  warnings: LegalWarning[]

  // Fatos Consolidados de Elegibilidade (Sem Viés Interpretativo)
  eligibilityInputs: EligibilityInputs
}

export interface LegalSentence {
  id: string
  sourceSnapshotId: string // Rastreabilidade de origem
  penaltyDays: number
  crimeDate: Date
  crimeProfile: CrimeProfile
}

export interface CrimeProfile {
  // Rastreabilidade Jurídica
  crimeCode: string // Ex: "ART_157_3"
  article: string   // Ex: "157 §3º"
  law: string       // Ex: "CP" ou "Lei 11.343/06"

  // Tipificação Operacional
  isHeinous: boolean
  isEquatedHeinous: boolean
  hasDeathResult: boolean
  isPrimary: boolean
  isRecidivist: boolean
  isSpecificRecidivist: boolean
}

export interface PenaltyTotals {
  totalPenaltyDays: number
  executedPenaltyDays: number
  remainingPenaltyDays: number
}

export interface RemissionFacts {
  homologatedDays: number
  pendingDays: number
}

export interface RegimePeriod {
  regime: 'closed' | 'semi_open' | 'open'
  startDate: Date
  endDate: Date | null
  isCurrent: boolean
  reason: 'initial_sentence' | 'progression' | 'regression' | 'correction'
}

export interface LegalIncident {
  type: 'escape' | 'recapture' | 'severe_infraction' | 'regime_regression' | 'new_conviction'
  date: Date
  sourceEventId: string // Rastreabilidade do evento gerador
  impactsProgression: boolean
  impactsParole: boolean
}

export interface LegalWarning {
  code: string // Ex: "WARN_MISSING_CRIME_DATE", "WARN_CONFLICTING_DATES"
  severity: 'info' | 'warning' | 'blocking'
  message: string
}

export interface EligibilityInputs {
  // Matriz agrupada de todos os perfis criminais que compõem a execução.
  // Será consumida pelos Evaluators para decidir as frações dominantes.
  applicableCrimeProfiles: CrimeProfile[]
  
  // TODO(Phase 5B.3): Avaliar se requiresCriminologicalExam deve ser mantido 
  // aqui como fato extraído ou derivado pelos evaluators matemáticos.
  requiresCriminologicalExam: boolean 
}
