/**
 * Schema barrel — exports all Drizzle table definitions and enums.
 *
 * Import order follows the dependency graph:
 *   enums (no deps) → organizations → users → memberships → audit/events
 *   → domain entities (client, prison-unit, execution-case, etc.)
 *
 * Usage in drizzle.config.ts: schema: './src/schema/index.ts'
 * Usage in application code: import { organizations, users } from '@execflow/db/schema'
 *
 * Phase 1: foundation layer.
 * Phase 2: auth layer.
 * Phase 3: core legal domain entities (client, case, timeline, etc.)
 * Never add a table here before its schema file is complete and reviewed.
 */

// Enums — infrastructure enums (must be exported for Drizzle migrations)
export {
  organizationStatusEnum,
  userStatusEnum,
  membershipStatusEnum,
  membershipRoleEnum,
  actorTypeEnum,
  eventProcessingStatusEnum,
} from './_enums.ts'

// Enums — domain-specific enums (Phase 3)
export {
  clientStatusEnum,
  caseStatusEnum,
  caseKindEnum,
  regimeTypeEnum,
  snapshotStatusEnum,
  confidenceLevelEnum,
  intakeBundleStatusEnum,
  intakeSourceChannelEnum,
  documentStatusEnum,
  ocrStatusEnum,
  sensitivityLevelEnum,
  timelineEventCategoryEnum,
  timelineEventSourceEnum,
  timelineVisibilityEnum,
} from './_enums-domain.ts'

// Foundation entities (Phase 1)
export { organizations } from './organization.ts'
export { crawlerSyncLogs } from './crawler-sync-log.ts'
export { users } from './user.ts'
export { memberships } from './membership.ts'

// Audit and event infrastructure (Phase 1)
export { auditLogs } from './audit-log.ts'
export { domainEvents } from './domain-event.ts'

// Better Auth tables (Phase 2 — separate from domain tables)
// See auth-user.ts for architecture rationale on the two-table model.
export { authUsers } from './auth-user.ts'
export { authSessions } from './auth-session.ts'
export { authAccounts } from './auth-account.ts'
export { authVerifications } from './auth-verification.ts'

// Core legal domain entities (Phase 3)
// Import order respects FK dependencies: no table before its dependencies.
export { clients } from './client.ts'
export { prisonUnits } from './prison-unit.ts'
export { executionCases } from './execution-case.ts'
export { custodySnapshots } from './custody-snapshot.ts'
export { intakeBundles } from './intake-bundle.ts'
export { documents } from './document.ts'
export { ocrRuns } from './ocr-run.ts'
export { documentOcrResults } from './document-ocr-result.ts'
export { extractionRuns } from './extraction-run.ts'
export { documentExtractionResults } from './document-extraction-result.ts'
export { snapshotPromotions } from './snapshot-promotion.ts'
export { reviewDecisions } from './review-decision.ts'
export { timelineEvents } from './timeline-event.ts'
export { sentenceSnapshots } from './sentence-snapshot.ts'

// Enums — deadline and opportunity domain (Phase 5)
export {
  deadlineStatusEnum,
  deadlineClassEnum,
  deadlineOriginEnum,
  deadlinePriorityEnum,
  opportunityTypeEnum,
  opportunityStatusEnum,
  opportunityReviewActionEnum,
} from './_enums-deadline-opportunity.ts'

// Deadline and opportunity entities (Phase 5)
// Import order: deadline before deadline-history (FK dep); opportunity before reviews/history.
export { deadlines } from './deadline.ts'
export { deadlineHistory } from './deadline-history.ts'
export { opportunities } from './opportunity.ts'
export { opportunityReviews } from './opportunity-review.ts'
export { opportunityStatusHistory } from './opportunity-status-history.ts'

// Enums — queue and workflow (Phase 6)
export {
  queueTypeEnum,
  queueProjectionStatusEnum,
  workflowTaskStatusEnum,
  workflowTaskTypeEnum,
  escalationTriggerEnum,
} from './_enums-queue.ts'

// Queue, projection, and workflow entities (Phase 6)
export { queueProjections } from './queue-projection.ts'
export { workflowTasks } from './workflow-task.ts'
export { queueAssignments } from './queue-assignment.ts'
export { queueEscalations } from './queue-escalation.ts'
export { pieceDrafts, pieceDraftStatusEnum } from './piece-draft.ts'
export { crawlerSyncStatusEnum } from './crawler-sync-log.ts'

// Astrea e-mail ingestion + system health (court monitoring via IMAP)
export { astreaEmailLogs, astreaEmailStatusEnum, astreaExtractionMethodEnum } from './astrea-email-log.ts'
export { systemHealthChecks, healthCheckTypeEnum, healthCheckStatusEnum } from './system-health-check.ts'

// Painel jurídico — inventário OAB, intimações, integrações, histórico IA (Phase 8)
export { oabProfiles, inventoryItems } from './oab-inventory.ts'
export { courtCommunications } from './court-communication.ts'
export { integrationConnectors } from './integration-connector.ts'
export { aiInteractionLogs } from './ai-interaction-log.ts'
export { caseNotes } from './case-note.ts'
export { caseAnalysisRuns, caseAnalysisStatusEnum } from './case-analysis-run.ts'
export { calendarEvents } from './calendar-event.ts'
export { financialEntries } from './financial-entry.ts'
export type { OabProfile, NewOabProfile, InventoryItem, NewInventoryItem } from './oab-inventory.ts'
export type { CourtCommunication, NewCourtCommunication } from './court-communication.ts'
export type { IntegrationConnector, NewIntegrationConnector } from './integration-connector.ts'
export type { AiInteractionLog, NewAiInteractionLog } from './ai-interaction-log.ts'
export type { CaseNote, NewCaseNote } from './case-note.ts'
export type { CaseAnalysisRun, NewCaseAnalysisRun } from './case-analysis-run.ts'
export type { CalendarEvent, NewCalendarEvent } from './calendar-event.ts'
export type { FinancialEntry, NewFinancialEntry } from './financial-entry.ts'

// Re-export inferred types — Phase 1
export type { Organization, NewOrganization } from './organization.ts'
export type { User, NewUser } from './user.ts'
export type { Membership, NewMembership } from './membership.ts'
export type { AuditLog, NewAuditLog } from './audit-log.ts'
export type { DomainEvent, NewDomainEvent } from './domain-event.ts'
export type { AuthUser, NewAuthUser } from './auth-user.ts'
export type { AuthSession, NewAuthSession } from './auth-session.ts'
export type { AuthAccount, NewAuthAccount } from './auth-account.ts'
export type { AuthVerification, NewAuthVerification } from './auth-verification.ts'

// Re-export inferred types — Phase 3 domain entities
export type { Client, NewClient } from './client.ts'
export type { PrisonUnit, NewPrisonUnit } from './prison-unit.ts'
export type { ExecutionCase, NewExecutionCase } from './execution-case.ts'
export type { CustodySnapshot, NewCustodySnapshot } from './custody-snapshot.ts'
export type { IntakeBundle, NewIntakeBundle } from './intake-bundle.ts'
export type { Document, NewDocument } from './document.ts'
export type { OcrRun, NewOcrRun } from './ocr-run.ts'
export type { DocumentOcrResult, NewDocumentOcrResult } from './document-ocr-result.ts'
export type { ExtractionRun, NewExtractionRun } from './extraction-run.ts'
export type { DocumentExtractionResult, NewDocumentExtractionResult } from './document-extraction-result.ts'
export type { SnapshotPromotion, NewSnapshotPromotion } from './snapshot-promotion.ts'
export type { ReviewDecisionRecord, NewReviewDecisionRecord } from './review-decision.ts'
export type { TimelineEvent, NewTimelineEvent } from './timeline-event.ts'
export type { SentenceSnapshot, NewSentenceSnapshot } from './sentence-snapshot.ts'

// Re-export inferred types — Phase 5 (deadline and opportunity entities)
export type { Deadline, NewDeadline } from './deadline.ts'
export type { DeadlineHistoryRecord, NewDeadlineHistoryRecord } from './deadline-history.ts'
export type { Opportunity, NewOpportunity } from './opportunity.ts'
export type { OpportunityReview, NewOpportunityReview } from './opportunity-review.ts'
export type {
  OpportunityStatusHistoryRecord,
  NewOpportunityStatusHistoryRecord,
} from './opportunity-status-history.ts'

// Re-export inferred types — Phase 6 (queue and workflow entities)
export type { QueueProjection, NewQueueProjection } from './queue-projection.ts'
export type { WorkflowTask, NewWorkflowTask } from './workflow-task.ts'
export type { QueueAssignment, NewQueueAssignment } from './queue-assignment.ts'
export type { QueueEscalation, NewQueueEscalation } from './queue-escalation.ts'
export type { PieceDraft, NewPieceDraft } from './piece-draft.ts'

// Enums — engine and playbook (Phase 7)
export {
  playbookStatusEnum,
  strategyProfileEnum,
  engineRunStatusEnum,
  engineRunTriggerEnum,
  ruleOutcomeEnum,
  uncertaintyLevelEnum,
  snapshotDependencyTypeEnum,
  recalculationRunStatusEnum,
  legalFractionEnum,
} from './_enums-engine.ts'

// Playbook governance entities (Phase 7)
export { playbookFamilies } from './playbook-family.ts'
export { playbookVersions } from './playbook-version.ts'
export { orgPlaybookConfigs } from './org-playbook-config.ts'
export { casePlaybookContexts } from './case-playbook-context.ts'

// Engine run and computation entities (Phase 7)
export { engineRuns } from './engine-run.ts'
export { engineRuleTraces } from './engine-rule-trace.ts'
export { explanationBundles } from './explanation-bundle.ts'
export { snapshotDependencies } from './snapshot-dependency.ts'
export { recalculationRuns } from './recalculation-run.ts'

// Re-export inferred types — Phase 7 (engine and playbook entities)
export type { PlaybookFamily, NewPlaybookFamily } from './playbook-family.ts'
export type { PlaybookVersion, NewPlaybookVersion } from './playbook-version.ts'
export type { OrgPlaybookConfig, NewOrgPlaybookConfig } from './org-playbook-config.ts'
export type { CasePlaybookContext, NewCasePlaybookContext } from './case-playbook-context.ts'
export type { EngineRun, NewEngineRun } from './engine-run.ts'
export type { EngineRuleTrace, NewEngineRuleTrace } from './engine-rule-trace.ts'
export type { ExplanationBundle, NewExplanationBundle } from './explanation-bundle.ts'
export type { SnapshotDependency, NewSnapshotDependency } from './snapshot-dependency.ts'
export type { RecalculationRun, NewRecalculationRun } from './recalculation-run.ts'
