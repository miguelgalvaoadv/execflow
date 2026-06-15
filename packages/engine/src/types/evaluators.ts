export type BenefitType =
  | 'progression'
  | 'parole'
  | 'remission'
  | 'indult'
  | 'commutation'
  | 'temporary_leave'
  | 'external_work';

// Re-export CrimeProfile so consumers can import it from evaluators.ts
export type { CrimeProfile } from '../types/legal-facts.js'

export interface EvaluationBatch {
  batchId: string;
  executionCaseId: string;
  engineRunId: string;
  playbookVersion: string;
  evaluatedAt: Date;
  batchStatus: 'completed' | 'partial' | 'failed';
  evaluations: BenefitEvaluation[];
}

export interface BenefitEvaluation {
  evaluationId: string;
  benefitType: BenefitType;

  // --- Evaluation context (provenance) ---
  engineRunId: string;
  executionCaseId: string;
  evaluatedAt: Date;
  playbookVersion: string;

  // Layer 1: Interpreter
  ruleApplied: ResolvedRuleSet;
  
  // Layer 2: Math
  calculationResult: CalculationResult;
  
  // Layer 3: Assessment
  eligibilityStatus: EligibilityAssessment;
  
  // Layer 4: Audit & Traceability
  rationale: RationaleStep[]; 
}

export interface RationaleStep {
  code: string;        
  title: string;       
  description: string; 
  source?: string;     
}

export interface ResolvedRuleSet {
  sentencesRules: SentenceRule[];
  requiresCriminologicalExam: boolean;
}

export interface SentenceRule {
  sentenceId: string;
  fraction: number; 
  legalBasis: string; 
  law: string; 
}

export interface CalculationResult {
  baseDate: Date; 
  projectedEligibilityDate: Date; 
  fractionalDaysNeeded: number; 
  daysAlreadyServed: number; 
  missingDays: number;
}

export interface EligibilityAssessment {
  status: 'eligible' | 'pending' | 'blocked';
  blockingConditions: AssessmentBlocker[];
}

export interface AssessmentBlocker {
  code: string;
  description: string;
  category: 'legal' | 'documental' | 'behavioral' | 'procedural' | 'system';
  isOverridable: boolean;
}

export interface OpportunityProposal {
  type: string;
  status: 'suggested' | 'identified';
  targetDate: Date;
  
  // Dashboard Triage Scoring
  confidence: 'high' | 'medium' | 'low';
  priority: 'low' | 'medium' | 'high' | 'critical';
  
  evaluationTrace: BenefitEvaluation;
}
