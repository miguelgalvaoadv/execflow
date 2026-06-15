/**
 * PostgreSQL enum types for Queue, Projection, and WorkflowTask entities.
 *
 * Phase 6: Queue engine and workflow orchestration.
 *
 * These enums define the concrete operational catalog of:
 *   - Queue types (office-operating-system.md §2.1)
 *   - QueueProjection lifecycle states
 *   - WorkflowTask lifecycle states and types
 *   - Escalation trigger categories
 *
 * DESIGN DECISIONS:
 * - Queue types are the definitive list from office-operating-system.md.
 *   Adding a new queue requires updating this enum + migration.
 * - WorkflowTask types are functional categories; they can grow as new
 *   operational workflows are identified without breaking existing logic.
 *
 * Architecture ref: office-operating-system.md §2, §4.
 */

import { pgEnum } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Queue types
// ---------------------------------------------------------------------------

/**
 * Named queues from the office operating system.
 * Each type has defined entry/exit criteria, SLA, ownership, and escalation rules.
 * Architecture ref: office-operating-system.md §2.1.
 */
export const queueTypeEnum = pgEnum('queue_type', [
  'intake_review',            // Unlinked docs / intake bundles awaiting association
  'extraction_review',        // OCR output awaiting human confirmation
  'missing_data',             // Engine or workflow flagged required data absent
  'progression_opportunities',// Progression suggestions needing lawyer strategy
  'pad_defense',              // Disciplinary matters with open defense windows
  'overdue_deadlines',        // All overdue obligations (legal, benefit, internal)
  'pending_filings',          // Approved pieces not yet marked filed
  'recalculation_conflicts',  // Conflicting snapshots or arithmetic mismatches
  'ai_review',                // AI outputs needing assistant triage
  'urgent_liberty_risks',     // High-severity: liberty-at-stake situations
  'opportunity_review',       // Opportunities awaiting lawyer review (non-progression)
  'snapshot_review',          // Proposed snapshots awaiting lawyer confirmation
  'workflow_tasks',           // Internal operational tasks assigned to staff
])

// ---------------------------------------------------------------------------
// QueueProjection lifecycle
// ---------------------------------------------------------------------------

/**
 * Lifecycle state of a queue projection entry.
 *
 * QueueProjection is a mutable materialized view of active queue items.
 * It is rebuilt from DomainEvents and entity tables (replay-safe).
 *
 * STATE MACHINE:
 *   active → snoozed (user snoozes non-critical item)
 *   active → deferred (user defers to future date)
 *   active → blocked (engine detects blocking condition)
 *   active → resolved (entity has left the queue)
 *   snoozed → active (snooze expires — via SLA sweep)
 *   deferred → active (deferral date reached — via SLA sweep)
 *   blocked → active (blocking condition cleared — via event consumer)
 *   * → resolved (any state can be resolved when entity exits queue)
 *
 * Terminal state: resolved.
 * Snoozed and deferred are NON-CRITICAL only (see office-operating-system §2.2).
 * Critical and liberty-risk items cannot be snoozed.
 */
export const queueProjectionStatusEnum = pgEnum('queue_projection_status', [
  'active',    // In queue; awaiting action
  'snoozed',   // Temporarily hidden; re-surfaces on snooze_until
  'deferred',  // Hidden until deferred_until date; user decision
  'blocked',   // Cannot be actioned (blocking condition active)
  'resolved',  // Terminal: entity left queue (completed, dismissed, etc.)
])

// ---------------------------------------------------------------------------
// WorkflowTask lifecycle
// ---------------------------------------------------------------------------

/**
 * Lifecycle states for WorkflowTask.
 *
 * STATE MACHINE:
 *   pending → claimed (staff member claims task)
 *   claimed → in_progress (staff begins working)
 *   claimed → released (staff releases back to pool)
 *   released → claimed (another staff member claims)
 *   in_progress → blocked (waiting for external input)
 *   blocked → in_progress (blocker resolved)
 *   pending | claimed | in_progress | blocked → completed (task done; terminal)
 *   pending | claimed | in_progress | blocked → cancelled (task no longer needed; terminal)
 *   pending | claimed | in_progress → escalated (SLA breach)
 *   escalated → claimed (senior staff picks up)
 *
 * Terminal states: completed, cancelled.
 * Released differs from pending: released tracks "was previously claimed by X".
 */
export const workflowTaskStatusEnum = pgEnum('workflow_task_status', [
  'pending',     // Created; awaiting claim
  'claimed',     // Staff member has claimed this task
  'released',    // Previously claimed; returned to pool
  'in_progress', // Staff is actively working
  'blocked',     // Blocked by external dependency
  'completed',   // Terminal: successfully done
  'cancelled',   // Terminal: task no longer needed
  'escalated',   // SLA breach; surfaced to senior staff or lawyer
])

/**
 * Operational task types — what kind of work this task represents.
 *
 * These types drive:
 * - Which role pool sees the task
 * - What checklist/template is shown
 * - What SLA applies
 * - What completion evidence is expected
 *
 * Architecture ref: office-operating-system.md §3 (ownership and assignment).
 */
export const workflowTaskTypeEnum = pgEnum('workflow_task_type', [
  'review_extraction',     // Confirm OCR-extracted fields for a document
  'confirm_document',      // Associate and confirm a document to a case
  'prepare_piece',         // Draft a legal piece for lawyer review
  'collect_missing_data',  // Gather missing information flagged by engine/workflow
  'confirm_filing',        // Record filing evidence after piece approval
  'review_opportunity',    // Triage an opportunity for lawyer qualification
  'case_health_review',    // Quarterly/periodic case health assessment
  'deadline_action',       // Action a specific deadline (linked deadline_id)
  'intake_triage',         // Triage new intake bundle
  'follow_up',             // Follow up with client, family, or prison unit
  'recalculation_review',  // Review arithmetic conflict or recalculation
  'pad_defense',           // Prepare PAD defense documents and response
  'generic',               // Catch-all for unclassified operational tasks
])

// ---------------------------------------------------------------------------
// Escalation trigger categories
// ---------------------------------------------------------------------------

/**
 * What triggered an escalation record.
 * Stored in QueueEscalation.trigger_reason to enable escalation analytics.
 *
 * Architecture ref: execution-workflows.md §4.5, office-operating-system.md §6.
 */
export const escalationTriggerEnum = pgEnum('escalation_trigger', [
  'sla_breach',           // SLA deadline passed without action
  'overdue_legal',        // Legal deadline past due
  'liberty_risk',         // Liberty-class risk detected
  'unacknowledged',       // Item not acknowledged within required window
  'blocking_unresolved',  // Blocking condition not resolved within SLA
  'manual',               // Human explicitly escalated
  'repeated_failure',     // Multiple processing failures on same item
])
