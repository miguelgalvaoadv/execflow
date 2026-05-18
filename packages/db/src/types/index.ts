/**
 * Shared TypeScript types for the EXECFLOW database layer.
 *
 * These types are derived from the Drizzle schema and shared across the monorepo
 * via the @execflow/db/types export. They are the canonical types for all
 * database entities — do not duplicate them in other packages.
 *
 * Usage:
 *   import type { Organization, ExecutionCase } from '@execflow/db/types'
 *
 * Phase 1: foundation entity types.
 * Phase 2: auth types.
 * Phase 3: core legal domain entity types.
 */

// ---------------------------------------------------------------------------
// Entity types (Phase 1 + Phase 2)
// ---------------------------------------------------------------------------

export type {
  Organization,
  NewOrganization,
  User,
  NewUser,
  Membership,
  NewMembership,
  AuditLog,
  NewAuditLog,
  DomainEvent,
  NewDomainEvent,
} from '../schema/index.ts'

// ---------------------------------------------------------------------------
// Entity types (Phase 3 — core legal domain)
// ---------------------------------------------------------------------------

export type {
  Client,
  NewClient,
  PrisonUnit,
  NewPrisonUnit,
  ExecutionCase,
  NewExecutionCase,
  CustodySnapshot,
  NewCustodySnapshot,
  IntakeBundle,
  NewIntakeBundle,
  Document,
  NewDocument,
  TimelineEvent,
  NewTimelineEvent,
  SentenceSnapshot,
  NewSentenceSnapshot,
} from '../schema/index.ts'

// ---------------------------------------------------------------------------
// Enum value types — infrastructure (Phase 1)
// ---------------------------------------------------------------------------

import type {
  organizationStatusEnum,
  userStatusEnum,
  membershipStatusEnum,
  membershipRoleEnum,
  actorTypeEnum,
  eventProcessingStatusEnum,
} from '../schema/index.ts'

export type OrganizationStatus = typeof organizationStatusEnum.enumValues[number]
export type UserStatus = typeof userStatusEnum.enumValues[number]
export type MembershipStatus = typeof membershipStatusEnum.enumValues[number]
export type MembershipRole = typeof membershipRoleEnum.enumValues[number]
export type ActorType = typeof actorTypeEnum.enumValues[number]
export type EventProcessingStatus = typeof eventProcessingStatusEnum.enumValues[number]

// ---------------------------------------------------------------------------
// Enum value types — domain (Phase 3)
// ---------------------------------------------------------------------------

import type {
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
} from '../schema/index.ts'

export type ClientStatus = typeof clientStatusEnum.enumValues[number]
export type CaseStatus = typeof caseStatusEnum.enumValues[number]
export type CaseKind = typeof caseKindEnum.enumValues[number]
export type RegimeType = typeof regimeTypeEnum.enumValues[number]
export type SnapshotStatus = typeof snapshotStatusEnum.enumValues[number]
export type ConfidenceLevel = typeof confidenceLevelEnum.enumValues[number]
export type IntakeBundleStatus = typeof intakeBundleStatusEnum.enumValues[number]
export type IntakeSourceChannel = typeof intakeSourceChannelEnum.enumValues[number]
export type DocumentStatus = typeof documentStatusEnum.enumValues[number]
export type OcrStatus = typeof ocrStatusEnum.enumValues[number]
export type SensitivityLevel = typeof sensitivityLevelEnum.enumValues[number]
export type TimelineEventCategory = typeof timelineEventCategoryEnum.enumValues[number]
export type TimelineEventSource = typeof timelineEventSourceEnum.enumValues[number]
export type TimelineVisibility = typeof timelineVisibilityEnum.enumValues[number]

// ---------------------------------------------------------------------------
// Entity types (Phase 5 — deadline and opportunity)
// ---------------------------------------------------------------------------

export type {
  Deadline,
  NewDeadline,
  DeadlineHistoryRecord,
  NewDeadlineHistoryRecord,
  Opportunity,
  NewOpportunity,
  OpportunityReview,
  NewOpportunityReview,
  OpportunityStatusHistoryRecord,
  NewOpportunityStatusHistoryRecord,
} from '../schema/index.ts'

// ---------------------------------------------------------------------------
// Enum value types — deadline and opportunity (Phase 5)
// ---------------------------------------------------------------------------

import type {
  deadlineStatusEnum,
  deadlineClassEnum,
  deadlineOriginEnum,
  deadlinePriorityEnum,
  opportunityTypeEnum,
  opportunityStatusEnum,
  opportunityReviewActionEnum,
} from '../schema/index.ts'

export type DeadlineStatus = typeof deadlineStatusEnum.enumValues[number]
export type DeadlineClass = typeof deadlineClassEnum.enumValues[number]
export type DeadlineOrigin = typeof deadlineOriginEnum.enumValues[number]
export type DeadlinePriority = typeof deadlinePriorityEnum.enumValues[number]
export type OpportunityType = typeof opportunityTypeEnum.enumValues[number]
export type OpportunityStatus = typeof opportunityStatusEnum.enumValues[number]
export type OpportunityReviewAction = typeof opportunityReviewActionEnum.enumValues[number]

// ---------------------------------------------------------------------------
// Entity types (Phase 6 — queue and workflow)
// ---------------------------------------------------------------------------

export type {
  QueueProjection,
  NewQueueProjection,
  WorkflowTask,
  NewWorkflowTask,
  QueueAssignment,
  NewQueueAssignment,
  QueueEscalation,
  NewQueueEscalation,
} from '../schema/index.ts'

// Enum value types — queue and workflow (Phase 6)
import type {
  queueTypeEnum,
  queueProjectionStatusEnum,
  workflowTaskStatusEnum,
  workflowTaskTypeEnum,
  escalationTriggerEnum,
} from '../schema/index.ts'

export type QueueType = typeof queueTypeEnum.enumValues[number]
export type QueueProjectionStatus = typeof queueProjectionStatusEnum.enumValues[number]
export type WorkflowTaskStatus = typeof workflowTaskStatusEnum.enumValues[number]
export type WorkflowTaskType = typeof workflowTaskTypeEnum.enumValues[number]
export type EscalationTrigger = typeof escalationTriggerEnum.enumValues[number]

// ---------------------------------------------------------------------------
// Entity types (Phase 7 — engine and playbook)
// ---------------------------------------------------------------------------

export type {
  PlaybookFamily,
  NewPlaybookFamily,
  PlaybookVersion,
  NewPlaybookVersion,
  OrgPlaybookConfig,
  NewOrgPlaybookConfig,
  CasePlaybookContext,
  NewCasePlaybookContext,
  EngineRun,
  NewEngineRun,
  EngineRuleTrace,
  NewEngineRuleTrace,
  ExplanationBundle,
  NewExplanationBundle,
  SnapshotDependency,
  NewSnapshotDependency,
  RecalculationRun,
  NewRecalculationRun,
} from '../schema/index.ts'

// Enum value types — engine and playbook (Phase 7)
import type {
  playbookStatusEnum,
  strategyProfileEnum,
  engineRunStatusEnum,
  engineRunTriggerEnum,
  ruleOutcomeEnum,
  uncertaintyLevelEnum,
  snapshotDependencyTypeEnum,
  recalculationRunStatusEnum,
} from '../schema/index.ts'

export type PlaybookStatus = typeof playbookStatusEnum.enumValues[number]
export type StrategyProfile = typeof strategyProfileEnum.enumValues[number]
export type EngineRunStatus = typeof engineRunStatusEnum.enumValues[number]
export type EngineRunTrigger = typeof engineRunTriggerEnum.enumValues[number]
export type RuleOutcome = typeof ruleOutcomeEnum.enumValues[number]
export type UncertaintyLevel = typeof uncertaintyLevelEnum.enumValues[number]
export type SnapshotDependencyType = typeof snapshotDependencyTypeEnum.enumValues[number]
export type RecalculationRunStatus = typeof recalculationRunStatusEnum.enumValues[number]

// ---------------------------------------------------------------------------
// AuditLog write helper types
// ---------------------------------------------------------------------------

/**
 * Structured type for the `changes` field in AuditLog.
 * Callers construct this to describe what changed in a state transition.
 *
 * Architecture ref: event-state-architecture.md §8.5 (before/after snapshots).
 */
export type AuditChanges =
  | { type: 'state_transition'; previous: string; next: string; reason?: string }
  | { type: 'creation'; snapshot: Record<string, unknown> }
  | { type: 'confirmation'; snapshot: Record<string, unknown> }
  | { type: 'field_update'; fields: Record<string, { previous: unknown; next: unknown }> }
  | { type: 'deletion_soft'; reason: string }

/**
 * Structured type for the `metadata` field in AuditLog.
 * Encodes the provenance chain for this audit entry.
 *
 * Architecture ref: event-state-architecture.md §8.4 (provenance tracking).
 */
export type AuditMetadata = {
  /** OpenTelemetry trace correlation */
  requestId?: string
  /** The domain_event.id that triggered this action (for automated actions) */
  triggerEventId?: string
  /** The engine run that produced this outcome */
  engineRunId?: string
  /** The playbook version that governed this action */
  playbookVersionId?: string
  /** The parent entity from which this entity was derived */
  parentEntityId?: string
  /** Mastra workflow run identifier (for AI-agent-produced actions) */
  mastraWorkflowId?: string
}

// ---------------------------------------------------------------------------
// DomainEvent write helper types
// ---------------------------------------------------------------------------

/**
 * Structured type for the `metadata` field in DomainEvent.
 * Architecture ref: event-state-architecture.md §2.4 (AI events).
 */
export type DomainEventMetadata = {
  requestId?: string
  playbookVersionId?: string
  engineRunId?: string
  mastraWorkflowId?: string
}

// ---------------------------------------------------------------------------
// Repository base types
// ---------------------------------------------------------------------------

/**
 * Standard result type for all repository operations.
 * Repositories never throw — they return a typed result.
 *
 * Usage:
 *   async function findOrganization(id: string): Promise<RepositoryResult<Organization>>
 *
 * This pattern ensures the calling service must handle both success and failure
 * paths explicitly — no silent exception swallowing.
 */
export type RepositoryResult<T> =
  | { success: true; data: T }
  | { success: false; error: RepositoryError }

/**
 * Typed error categories for repository operations.
 * Callers pattern-match on `code` to handle each case.
 */
export type RepositoryError = {
  /** The error category */
  code:
    | 'NOT_FOUND'          // Entity does not exist or not visible in org context
    | 'CONFLICT'           // Unique constraint violation (e.g., duplicate email)
    | 'CONSTRAINT'         // FK constraint, enum constraint, or non-nullable violation
    | 'IMMUTABILITY'       // Attempted update of an immutable field or append-only table
    | 'FORBIDDEN'          // Actor does not have permission for this operation
    | 'UNKNOWN'            // Unexpected database error
  /** Human-readable message for logging and debugging (not for end-user display) */
  message: string
  /** The underlying error, if available */
  cause?: unknown
}

/**
 * Pagination parameters for list queries.
 * All list queries are paginated — unbounded list queries are forbidden.
 * Architecture ref: ENGINEERING_PRINCIPLES.md §11 (scale for hundreds/thousands).
 */
export type PaginationParams = {
  /** Maximum number of records to return. Default 50, max 200. */
  limit: number
  /** Cursor-based offset using the last seen ID. Prefer over OFFSET for large tables. */
  cursor?: string
}

/**
 * Paginated result wrapper for list repository operations.
 */
export type PaginatedResult<T> = {
  items: T[]
  /** The cursor to pass as `cursor` for the next page. Null if no more pages. */
  nextCursor: string | null
  /** Total count of items matching the query (may be approximate for large tables). */
  totalCount: number
}
