/**
 * Core type contracts for the EXECFLOW legal computation engine.
 *
 * These types define the input/output interfaces for all engine components.
 * The type system enforces:
 * - Pure functions: rule evaluators accept RuleEvaluatorInput, return RuleEvaluatorOutput
 * - No side effects: no DB access types inside rule evaluator contracts
 * - Explicit provenance: every output traces to its playbook rule and version
 * - Uncertainty as first-class state: never collapse ambiguity into a single value
 *
 * Architecture ref: execution-engine.md §0 (engine principles),
 *                   playbook-system.md §7 (engine integration).
 */

// ---------------------------------------------------------------------------
// Confidence and uncertainty
// ---------------------------------------------------------------------------

/**
 * Confidence levels for engine outputs — execution-engine.md §3.7.
 * high    → All confirmed inputs; unambiguous calculation; no blocking incidents.
 * medium  → Minor missing optional data; single low-confidence field on non-critical.
 * low     → Disputed dates, partial critical data; output unreliable.
 * unknown → Insufficient data to evaluate.
 * blocked → Active blocking condition prevents output.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown' | 'blocked'

/**
 * Uncertainty level for the overall engine run — execution-engine.md §5.
 */
export type UncertaintyLevel = 'none' | 'low' | 'medium' | 'high' | 'blocking'

/**
 * Uncertainty factor — identifies a specific source of uncertainty.
 * Architecture ref: execution-engine.md §5.1.
 */
export type UncertaintyFactor = {
  code:
    | 'CONFLICTING_CALCULATIONS'
    | 'DISPUTED_DATES'
    | 'INCOMPLETE_RECORDS'
    | 'UNCERTAIN_OCR'
    | 'DIVERGENT_INTERPRETATION'
    | 'PENDING_JUDICIAL_DECISION'
    | 'MISSING_CONFIRMATION'
    | 'STALE_DEPENDENCY'
  message: string
  /** Which engine outputs are affected by this uncertainty. */
  affectedOutputs: string[]
}

/**
 * Missing data item — what the engine needed but could not find.
 * Architecture ref: execution-engine.md §4.3.
 */
export type MissingDataItem = {
  /** The specific field or entity that is missing. */
  field: string
  /** Why this data is required for the evaluation. */
  whyNeeded: string
  /** How severely missing data affects the output. */
  severity: 'critical' | 'recommended' | 'optional'
}

// ---------------------------------------------------------------------------
// Playbook types
// ---------------------------------------------------------------------------

/**
 * Interpretation branch — a specific legal interpretation choice.
 * Architecture ref: playbook-system.md §5.1.
 */
export type PlaybookBranch = {
  branchId: string
  label: string
  isDefault: boolean
  /** Domain-specific parameters for the evaluator. Never hardcoded legal fractions. */
  parameters: Record<string, unknown>
  legalReferences: string[]
  riskDisclosureText?: string | undefined
  cautionLevel?: 'standard' | 'elevated' | 'prohibited_without_partner_review' | undefined
}

/**
 * A single legal rule within a rule group.
 * Architecture ref: playbook-system.md §2.3.
 */
export type PlaybookRule = {
  ruleId: string
  /** Which evaluator function handles this rule type. NOT legal logic itself. */
  evaluatorId: string
  cautionLevel: 'low' | 'elevated' | 'informational_only'
  requiresPartnerReview: boolean
  branches: PlaybookBranch[]
}

/**
 * A group of related rules.
 * Architecture ref: playbook-system.md §2.2.
 */
export type PlaybookRuleGroup = {
  groupId: string
  label: string
  rules: PlaybookRule[]
}

/**
 * The merged, resolved playbook for an engine run.
 * Result of: base version + org overlay + case context resolution.
 * Architecture ref: playbook-system.md §7.1.
 */
export type ResolvedPlaybook = {
  playbookVersionId: string
  overlayVersionId: string | null
  caseContextId: string | null
  strategyProfile: 'conservative' | 'standard' | 'aggressive'
  jurisdictionScope: string
  effectiveAt: Date
  groups: PlaybookRuleGroup[]
  /** Merged rule lookup: ruleId → { rule, selectedBranch } */
  ruleMap: Map<string, { rule: PlaybookRule; branch: PlaybookBranch }>
}

// ---------------------------------------------------------------------------
// Facts (confirmed inputs for rule evaluation)
// ---------------------------------------------------------------------------

/**
 * Sentence facts derived from the latest confirmed SentenceSnapshot.
 * Architecture ref: execution-engine.md §1 (sentence time model).
 */
export type SentenceFacts = {
  snapshotId: string
  effectiveAt: Date
  totalSentenceDays: number
  servedDays: number
  remissionDays: number
  detractionDays: number
  remainingDays: number
  percentServed: string
  confidenceLevel: 'high' | 'medium' | 'low' | 'unknown'
  missingDataFlags: Array<{ field: string; impact: 'high' | 'medium'; description: string }>
  playbookVersionId: string | null
}

/**
 * Custody facts derived from the latest confirmed CustodySnapshot.
 * Architecture ref: execution-engine.md §2 (temporal events).
 */
export type CustodyFacts = {
  snapshotId: string
  effectiveAt: Date
  regime: 'fechado' | 'semiaberto' | 'aberto' | 'albergue' | 'domiciliar' | 'provisorio' | 'unknown'
  prisonUnitId: string | null
  confidence: 'high' | 'medium' | 'low' | 'unknown'
}

/**
 * Active interruption affecting the case.
 * Architecture ref: execution-engine.md §1.7 (interruptions).
 */
export type ActiveInterruption = {
  type: 'progression' | 'all_liberty' | 'accrual_freeze'
  reason: string
  since: Date
  /** Whether this interruption resets accrual (vs just freezes it). */
  resetsAccrual: boolean
  sourceEventId: string | null
}

/**
 * A timeline event relevant to evaluation context.
 */
export type RelevantTimelineEvent = {
  eventId: string
  eventType: string
  occurredAt: Date
  category: string
  payload: Record<string, unknown>
}

/**
 * Complete confirmed facts for a case at a specific instant.
 * This is the primary input to all rule evaluators.
 * Architecture ref: execution-engine.md §4 (opportunity computation pipeline).
 */
export type CaseFacts = {
  organizationId: string
  executionCaseId: string
  evaluatedAt: Date
  sentence: SentenceFacts | null
  custody: CustodyFacts | null
  activeInterruptions: ActiveInterruption[]
  recentEvents: RelevantTimelineEvent[]
  /** Whether the case has a process number (pending = might block suggestions). */
  hasConfirmedProcessNumber: boolean
  /** Whether a confirmed SentenceSnapshot is within staleness threshold. */
  hasRecentConfirmedSnapshot: boolean
}

// ---------------------------------------------------------------------------
// Rule evaluator contracts (pure functions — no side effects)
// ---------------------------------------------------------------------------

/**
 * Input to a rule evaluator — pure function input.
 * Contains confirmed facts and playbook parameters. No DB clients.
 * Architecture ref: execution-engine.md §0 (confirmed facts only).
 */
export type RuleEvaluatorInput = {
  ruleId: string
  evaluatorId: string
  /** Parameters from the selected branch (never hardcoded). */
  parameters: Record<string, unknown>
  /** Confirmed facts available for evaluation. */
  facts: CaseFacts
  /** Playbook version this evaluation uses. */
  playbookVersionId: string
  /** Active blocking codes (may suppress this rule). */
  activeBlockingCodes: string[]
}

/**
 * Output of a rule evaluator — pure function output.
 * No DB writes permitted inside evaluators.
 */
export type RuleEvaluatorOutput = {
  outcome:
    | 'opportunity_suggested'
    | 'opportunity_blocked'
    | 'insufficient_data'
    | 'warning'
    | 'snapshot_proposal'
    | 'no_match'

  confidenceLevel: ConfidenceLevel
  uncertaintyLevel: UncertaintyLevel

  /**
   * Populated when outcome = 'opportunity_suggested'.
   * These drive Opportunity creation during the commit step.
   */
  opportunityProposal?: {
    opportunityType: string
    summary: string
    rationale: string
    windowStartAt: Date | null
    windowEndAt: Date | null
    riskLevel: 'critical' | 'high' | 'medium' | 'low'
    requiresLawyerReview: boolean
  } | undefined

  /** Blocking codes that suppressed this rule's output. */
  blockingCodes: string[]

  uncertaintyFactors: UncertaintyFactor[]
  missingData: MissingDataItem[]

  /**
   * Legal rules applied — included in ExplanationBundle.
   * Architecture ref: execution-engine.md §8.4.
   */
  legalRulesApplied: Array<{
    ruleId: string
    playbookVersionId: string
    branchId: string | null
    citationRef: string
  }>

  /**
   * Descriptive calculation steps (human-readable, not executable).
   * Architecture ref: execution-engine.md §8.3.
   */
  calculations: Array<{
    name: string
    inputs: Record<string, unknown>
    output: unknown
    confidence: ConfidenceLevel
    derivationNote: string
  }>

  /** Alternative interpretations when conflict exists. */
  alternatives?: Array<{
    interpretationId: string
    label: string
    outcome: string
    branchId: string
  }> | undefined
}

// ---------------------------------------------------------------------------
// Evaluation context (orchestration layer)
// ---------------------------------------------------------------------------

/**
 * Global blocking condition — suppresses all liberty-affecting suggestions.
 * Architecture ref: execution-engine.md §4.2.
 */
export type GlobalBlockingCode = {
  code: string
  reason: string
  severity: 'full' | 'partial'
}

/**
 * Full evaluation context built by the runtime before rule evaluation.
 * Immutable after construction — passed read-only to all evaluators.
 */
export type EvaluationContext = {
  runId: string
  organizationId: string
  executionCaseId: string
  evaluatedAt: Date
  playbook: ResolvedPlaybook
  facts: CaseFacts
  globalBlockingCodes: GlobalBlockingCode[]
}

// ---------------------------------------------------------------------------
// ExplanationBundle (structured legal explanation)
// ---------------------------------------------------------------------------

/**
 * Complete ExplanationBundle — execution-engine.md §8.1.
 * Stored as JSONB in explanation_bundles.payload.
 * Deterministic: same inputs + rules → same bundle (minus timestamps).
 *
 * Contains ONLY descriptive text. No executable code.
 */
export type ExplanationBundlePayload = {
  summary: string
  conclusionType: 'opportunity' | 'deadline' | 'warning' | 'snapshot_proposal'
  playbookVersion: {
    id: string
    label: string
    effectiveFrom: string
  }
  legalRulesApplied: Array<{
    ruleId: string
    playbookVersionId: string
    branchId: string | null
    citationRef: string
    parameters: Record<string, unknown>
  }>
  /** Descriptive calculation steps. NOT executable code. */
  calculations: Array<{
    name: string
    inputs: Record<string, unknown>
    output: unknown
    confidence: ConfidenceLevel
    derivationNote: string
  }>
  sourceDocuments: Array<{
    documentId: string
    fieldPaths: string[]
    spans?: string[] | undefined
  }>
  sourceEvents: Array<{
    timelineEventId: string
    eventType: string
  }>
  missingData: MissingDataItem[]
  uncertaintyIndicators: UncertaintyFactor[]
  blockingCodes: string[]
  alternatives: Array<{
    interpretationId: string
    label: string
    outcome: string
    branchId: string
  }>
}

// ---------------------------------------------------------------------------
// Engine run result (output of a full evaluation before DB commit)
// ---------------------------------------------------------------------------

/**
 * Result of a complete engine evaluation run.
 * Returned by runEvaluation() before commit to DB.
 * The commit step (runtime/commit.ts) persists this to the database.
 */
export type EngineRunResult = {
  runId: string
  organizationId: string
  executionCaseId: string
  playbookVersionId: string
  evaluatedAt: Date

  overallConfidence: ConfidenceLevel
  overallUncertaintyLevel: UncertaintyLevel
  globalBlockingCodes: string[]
  missingDataSummary: MissingDataItem[]

  ruleTraces: Array<{
    ruleId: string
    playbookVersionId: string
    evaluatorId: string
    evaluationOrder: number
    inputsHash: string
    outputsHash: string
    outcome: RuleEvaluatorOutput['outcome']
    uncertaintyLevel: UncertaintyLevel
    blockingCodes: string[]
    uncertaintyFactors: UncertaintyFactor[]
    missingDataRefs: MissingDataItem[]
    startedAt: Date
    completedAt: Date
    durationMs: number
    /** Full output snapshot for replay runs only. */
    outputsSnapshot?: RuleEvaluatorOutput | undefined
  }>

  opportunityProposals: Array<{
    ruleId: string
    opportunityType: string
    summary: string
    rationale: string
    confidenceLevel: ConfidenceLevel
    windowStartAt: Date | null
    windowEndAt: Date | null
    riskLevel: 'critical' | 'high' | 'medium' | 'low'
    requiresLawyerReview: boolean
    explanationBundle: ExplanationBundlePayload
  }>

  warnings: Array<{
    code: string
    message: string
    ruleId: string | null
  }>

  /** Dependencies consumed — persisted as snapshot_dependencies. */
  dependencies: Array<{
    dependencyType: 'sentence_snapshot' | 'custody_snapshot' | 'timeline_event' | 'document' | 'playbook_version'
    dependencyEntityId: string
    dependencyEffectiveAt: Date | null
    dependencyVersion: string | null
  }>
}

// ---------------------------------------------------------------------------
// Replay types
// ---------------------------------------------------------------------------

/**
 * Parameters for a point-in-time historical replay.
 * Architecture ref: execution-engine.md §7.
 */
export type ReplayRequest = {
  organizationId: string
  executionCaseId: string
  /** The historical instant to reconstruct state for. */
  asOfDate: Date
  /** Whether to use the playbook version effective at asOfDate (true) or current (false). */
  useHistoricalPlaybook: boolean
}

/**
 * Result of a historical replay evaluation.
 * NOT committed to DB as new Opportunities — for display only.
 * Architecture ref: execution-engine.md §7.4.
 */
export type ReplayBundle = {
  asOfDate: Date
  playbookVersionId: string
  facts: CaseFacts
  runResult: EngineRunResult
  /** Whether results match current engine run (consistency check). */
  consistentWithCurrent: boolean | null
}

// ---------------------------------------------------------------------------
// Recalculation propagation types
// ---------------------------------------------------------------------------

/**
 * Input to schedule a recalculation after a dependency change.
 */
export type RecalculationRequest = {
  organizationId: string
  executionCaseId: string
  triggerEntityType: string
  triggerEntityId: string
  triggerReason: string
  parentRecalculationRunId: string | null
  chainDepth: number
  /** Shared across the logical operation chain (propagated from upstream events). */
  correlationId: string | null
  /** domain_events.id of the upstream event that triggered this recalculation. */
  causationId: string | null
  /** Jurisdiction scope for playbook resolution (defaults to BR-FED). */
  jurisdictionScope?: string
}
