/**
 * WorkflowTask — an operational work item assigned to a staff member.
 *
 * WorkflowTasks are internal operational actions that staff need to complete:
 * - Review an OCR extraction
 * - Prepare a piece draft
 * - Collect missing documents
 * - Confirm a filing
 * - Follow up with client/prison
 *
 * Unlike Deadlines (legal obligations) and Opportunities (procedural advantages),
 * WorkflowTasks are INTERNAL operational coordination items.
 * They may be linked to Deadlines or Opportunities as execution actions.
 *
 * STATE MACHINE (strict):
 *   pending → claimed (staff member claims the task)
 *   claimed → in_progress (staff begins working)
 *   claimed → released (staff releases back to pool)
 *   released → claimed (another staff member claims)
 *   in_progress → blocked (external dependency blocking)
 *   blocked → in_progress (blocker resolved)
 *   pending | claimed | released | in_progress | blocked → completed (terminal)
 *   pending | claimed | released | in_progress | blocked → cancelled (terminal)
 *   pending | claimed | in_progress → escalated (SLA breach)
 *   escalated → claimed (senior staff picks up)
 *
 * Terminal states: completed, cancelled.
 *
 * CLAIM SEMANTICS:
 * Claiming is an optimistic lock — only one user may claim a task at a time.
 * Claiming is enforced at the service layer via conditional update (WHERE claimed_by_user_id IS NULL).
 * Double-claim attempts return a CONFLICT error.
 *
 * IMMUTABLE FIELDS: id, organization_id, task_type, created_at, created_by_user_id,
 *   source_entity_type, source_entity_id, causing_event_id.
 *
 * Architecture ref: office-operating-system.md §3 (ownership), §4 (review system).
 */

import {
  pgTable, uuid, text, timestamp, boolean, jsonb, index,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'
import { workflowTaskStatusEnum, workflowTaskTypeEnum } from './_enums-queue.ts'
import { deadlinePriorityEnum } from './_enums-deadline-opportunity.ts'

export const workflowTasks = pgTable(
  'workflow_tasks',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    // -------------------------------------------------------------------------
    // Tenant isolation — immutable
    // -------------------------------------------------------------------------

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Task classification — immutable after creation
    // -------------------------------------------------------------------------

    /**
     * Functional category of this task.
     * Determines: role pool, SLA, checklist template, completion evidence.
     * IMMUTABLE after creation.
     */
    taskType: workflowTaskTypeEnum('task_type').notNull(),

    // -------------------------------------------------------------------------
    // Content
    // -------------------------------------------------------------------------

    /** Short human-readable title. */
    title: text('title').notNull(),

    /** Extended description or instructions. */
    description: text('description'),

    // -------------------------------------------------------------------------
    // Lifecycle status
    // -------------------------------------------------------------------------

    status: workflowTaskStatusEnum('status').notNull().default('pending'),

    // -------------------------------------------------------------------------
    // Priority
    // -------------------------------------------------------------------------

    /**
     * Priority inheriting from Deadline/Opportunity priority system.
     * Used for queue ordering and notification urgency.
     */
    priority: deadlinePriorityEnum('priority').notNull().default('normal'),

    // -------------------------------------------------------------------------
    // Case linkage
    // -------------------------------------------------------------------------

    executionCaseId: uuid('execution_case_id').references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Source entity (what triggered this task)
    // -------------------------------------------------------------------------

    /**
     * Entity type that triggered this task.
     * Values: 'Deadline', 'Opportunity', 'IntakeBundle', 'Document', 'SentenceSnapshot'
     * Immutable.
     */
    sourceEntityType: text('source_entity_type'),

    /**
     * UUID of the entity that triggered this task.
     * Immutable.
     */
    sourceEntityId: uuid('source_entity_id'),

    /**
     * Domain event that caused this task to be created.
     * Immutable. Used for replay: "rebuild all tasks from events."
     */
    causingEventId: uuid('causing_event_id'),

    // -------------------------------------------------------------------------
    // Linked deadline (optional — task may mirror a legal deadline)
    // -------------------------------------------------------------------------

    /**
     * If this task is the operational mirror of a Deadline (per
     * office-operating-system §6.1 "every critical legal deadline spawns linked task"),
     * this points to that Deadline.
     */
    linkedDeadlineId: uuid('linked_deadline_id'),

    // -------------------------------------------------------------------------
    // Assignment / claim
    // -------------------------------------------------------------------------

    /**
     * Current claimant (the user who owns this task right now).
     * Null = unclaimed (pool task).
     * Set at claim; cleared at release; set again at re-claim.
     * Only ONE user may claim a task at a time (service-layer enforcement).
     */
    claimedByUserId: uuid('claimed_by_user_id').references(() => users.id),

    /** When the current claim was established. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),

    /**
     * Assignment from above (lawyer/lead assigns to specific person).
     * Different from claimedByUserId (which is self-claimed).
     * assignedToUserId is set by a supervisor; claimedByUserId by the worker themselves.
     */
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Blocking conditions
    // -------------------------------------------------------------------------

    /**
     * Whether a blocking condition is currently active.
     * Set by service when blocking is detected; cleared when resolved.
     */
    isBlocked: boolean('is_blocked').notNull().default(false),

    /** Description of the current blocking condition. */
    blockingReason: text('blocking_reason'),

    /**
     * Structured blocking conditions for UI rendering.
     * Schema: [{ condition: string, type: string, entityRef?: string }]
     */
    blockingConditions: jsonb('blocking_conditions'),

    // -------------------------------------------------------------------------
    // Review requirement
    // -------------------------------------------------------------------------

    /**
     * Whether this task requires lawyer review before completion.
     * True for task types like prepare_piece, pad_defense.
     */
    requiresReview: boolean('requires_review').notNull().default(false),

    // -------------------------------------------------------------------------
    // SLA / due date
    // -------------------------------------------------------------------------

    /** When this task must be completed (operational deadline). */
    dueAt: timestamp('due_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Completion state (terminal)
    // -------------------------------------------------------------------------

    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id),

    /**
     * Evidence of completion.
     * completionEvidenceType: 'timeline_event' | 'document' | 'filing' | 'manual'
     * completionEvidenceId: UUID of the referenced entity
     */
    completionEvidenceType: text('completion_evidence_type'),
    completionEvidenceId: text('completion_evidence_id'),

    // -------------------------------------------------------------------------
    // Cancellation (terminal)
    // -------------------------------------------------------------------------

    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id),
    cancellationReason: text('cancellation_reason'),

    // -------------------------------------------------------------------------
    // Escalation state
    // -------------------------------------------------------------------------

    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    escalatedToUserId: uuid('escalated_to_user_id').references(() => users.id),
    escalationReason: text('escalation_reason'),

    // -------------------------------------------------------------------------
    // Task dependency chain (for sequences of related tasks)
    // -------------------------------------------------------------------------

    /**
     * Parent task in a dependency chain.
     * When this task must complete before another, parentTaskId points upward.
     */
    parentTaskId: uuid('parent_task_id').references(
      (): AnyPgColumn => workflowTasks.id
    ),

    // -------------------------------------------------------------------------
    // Metadata
    // -------------------------------------------------------------------------

    /**
     * Structured task-type-specific context.
     * Schema varies by task_type.
     * For review_extraction: { documentId, fieldsToReview: [...] }
     * For prepare_piece: { opportunityId, pieceCategory, templateId? }
     */
    taskMetadata: jsonb('task_metadata'),

    // -------------------------------------------------------------------------
    // Provenance — immutable (created) / mutable (updated)
    // -------------------------------------------------------------------------

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * PRIMARY TASK QUEUE: "all pending/active tasks for org X, ordered by priority + due"
     */
    index('workflow_tasks_org_status_idx').on(
      table.organizationId,
      table.status,
      table.priority,
      table.dueAt
    ),

    /**
     * ASSIGNEE VIEW: "all tasks assigned to me or claimed by me"
     */
    index('workflow_tasks_assignee_idx').on(
      table.assignedToUserId,
      table.status
    ),
    index('workflow_tasks_claimed_idx').on(
      table.claimedByUserId,
      table.status
    ),

    /**
     * CASE VIEW: "all tasks for case X"
     */
    index('workflow_tasks_case_idx').on(
      table.executionCaseId,
      table.status
    ),

    /**
     * SOURCE ENTITY LOOKUP: "all tasks linked to entity X"
     */
    index('workflow_tasks_source_idx').on(
      table.sourceEntityType,
      table.sourceEntityId
    ),

    /**
     * SLA SWEEP: "unclaimed tasks past due date"
     */
    index('workflow_tasks_due_idx').on(
      table.organizationId,
      table.dueAt,
      table.status
    ),
  ]
)

export type WorkflowTask = typeof workflowTasks.$inferSelect
export type NewWorkflowTask = typeof workflowTasks.$inferInsert
