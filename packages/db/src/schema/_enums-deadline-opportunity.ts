/**
 * PostgreSQL enum types for Deadline and Opportunity entities.
 *
 * Phase 5: Deadline and opportunity operational foundation.
 *
 * These enums encode the state machines described in:
 *   - execution-workflows.md §4 (deadline system)
 *   - execution-workflows.md §5 (opportunity lifecycle)
 *   - data-model-v1.md §2.8 (Deadline) and §2.9 (Opportunity)
 *
 * State machine discipline (ARCHITECTURE_RULES.md):
 *   - Enum values represent STATES, not intentions.
 *   - All transitions are explicit and audited.
 *   - Terminal states never allow further transitions.
 *   - No silent state derivation in application code.
 */

import { pgEnum } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Deadline enums
// ---------------------------------------------------------------------------

/**
 * Deadline lifecycle states.
 *
 * Lifecycle: open → acknowledged → (overdue | completed | dismissed)
 *            open → overdue → (completed | dismissed)
 *
 * Terminal states: completed, dismissed.
 * Overdue is NOT derived — it is set explicitly (by engine or SLA job, Phase 5+).
 * Setting it explicitly avoids silent state changes from wall-clock comparisons.
 *
 * Architecture ref: execution-workflows.md §4.6 (overdue behavior).
 */
export const deadlineStatusEnum = pgEnum('deadline_status', [
  'open',          // Created; awaiting action or acknowledgement
  'acknowledged',  // Actor has explicitly seen and acknowledged the deadline
  'overdue',       // Past due_at; not yet completed or dismissed
  'completed',     // Satisfied with linked evidence
  'dismissed',     // Discarded; lawyer-only for overdue dismissal
])

/**
 * Deadline thematic class.
 * Determines notification urgency, escalation behavior, and queue display.
 *
 * Architecture ref: execution-workflows.md §4.1 (deadline classes).
 */
export const deadlineClassEnum = pgEnum('deadline_class', [
  'legal',          // Court-facing deadline (manifestação, recurso, cumprimento)
  'benefit',        // Benefit window (prazo para requerer progressão, etc.)
  'disciplinary',   // PAD defense, disciplinary appeal window
  'calculation',    // Arithmetic challenge window (impugnação, planilha)
  'internal',       // Firm SLA (review document, approve piece)
  'recurring',      // Scheduled review cycle (caso health, benefit eligibility)
  'sla',            // Process-number SLA, intake-association SLA
])

/**
 * How the deadline was created.
 * Immutable after creation — set once at insert, never updated.
 *
 * Architecture ref: execution-workflows.md §4.2 (creation modes).
 */
export const deadlineOriginEnum = pgEnum('deadline_origin', [
  'manual',     // Staff created it explicitly
  'extracted',  // OCR/tribunal text proposed date; human accepted
  'rule',       // Rule engine derived from confirmed event + playbook
  'recurring',  // Spawned from a recurring review schedule
])

/**
 * Deadline priority levels.
 * Drives notification frequency and escalation rules.
 *
 * Architecture ref: execution-workflows.md §4.4 (criticality and alerts).
 */
export const deadlinePriorityEnum = pgEnum('deadline_priority', [
  'critical', // Immediate alert; repeat daily when overdue
  'high',     // D-7, D-3, D-1 notifications
  'normal',   // D-7 notification
  'low',      // Dashboard display only; no proactive notification
])

// ---------------------------------------------------------------------------
// Opportunity enums
// ---------------------------------------------------------------------------

/**
 * Opportunity type — the specific procedural advantage being tracked.
 * Immutable after creation.
 *
 * Each type has specific data requirements, triggers, and human gates.
 * See execution-workflows.md §5.2 (opportunity catalog) for full details.
 *
 * Engine note: types NOT in this enum may not appear as engine-generated
 * suggestions (type is an integrity fence for engine output validation).
 */
export const opportunityTypeEnum = pgEnum('opportunity_type', [
  'progression',      // Progressão de regime (regime advancement)
  'remission',        // Remição (work/study credit recognition)
  'detraction',       // Detração (preventive custody credit)
  'amnesty',          // Indulto (presidential pardon/amnesty)
  'commutation',      // Comutação (sentence reduction decree)
  'hc',               // Habeas corpus opportunity
  'pad_challenge',    // PAD disciplinary proceeding challenge
  'prescription',     // Executory prescription (prescrição)
  'recalculation',    // Sentence arithmetic recalculation
  'excess_execution', // Excesso de execução (served more than sentence)
  'rights_violation', // Direito violado (rights violation)
  'manual',           // Manually created opportunity not covered by above types
])

/**
 * Opportunity lifecycle status.
 *
 * Lifecycle:
 *   suggested → qualified → pursuing → realized (terminal)
 *   suggested → dismissed (terminal)
 *   qualified → dismissed (terminal)
 *   pursuing  → dismissed (terminal)
 *   any-non-terminal → expired (terminal, engine-managed)
 *
 * Terminal states: realized, dismissed, expired.
 * All transitions require explicit actor attribution + explanation (via OpportunityReview).
 *
 * Architecture ref: execution-workflows.md §5.4 (opportunity lifecycle).
 */
export const opportunityStatusEnum = pgEnum('opportunity_status', [
  'suggested',  // Engine or manual suggestion; awaiting lawyer review
  'qualified',  // Lawyer has confirmed this is a real, actionable opportunity
  'pursuing',   // Active: piece is being drafted or action is in progress
  'realized',   // Terminal: opportunity successfully acted upon (piece filed)
  'dismissed',  // Terminal: lawyer discarded this opportunity with reason
  'expired',    // Terminal: window closed before action was taken
])

/**
 * Review action type for OpportunityReview records.
 * Each review creates an immutable row; this identifies the action taken.
 *
 * Architecture ref: data-model-v1.md §2.9, AI_BOUNDARIES.md.
 */
export const opportunityReviewActionEnum = pgEnum('opportunity_review_action', [
  'qualified',          // Lawyer promotes suggested → qualified
  'rejected',           // Lawyer rejects; opportunity → dismissed
  'changes_requested',  // Reviewer asks for data updates before proceeding
  'deferred',           // Reviewer postpones review; sets deferred_until
  'escalated',          // Reviewer escalates to another lawyer/admin
  'pursuing_started',   // Qualified opportunity moved to pursuing
  'realized',           // Lawyer marks opportunity as realized (piece filed)
])
