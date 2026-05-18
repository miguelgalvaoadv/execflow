/**
 * ExecutionCase — the operational container for one *execução penal* matter.
 *
 * This is the central entity of EXECFLOW. Everything else (documents, timeline
 * events, snapshots, deadlines, opportunities, pieces) belongs to an ExecutionCase.
 *
 * DOMAIN CONTEXT (execution-workflows.md §2):
 * An execution case represents a specific penal execution proceeding for a client:
 * - A client may have multiple active execution cases (concurrent convictions).
 * - Cases may have apensos (supplementary proceedings) linked via parent_execution_case_id.
 * - The process number (execution_process_number) is the court identifier;
 *   it may be unknown at case creation (status='intake') and filled in later.
 *
 * PROCESS NUMBER:
 * The execution_process_number is the unique court identifier for this execution.
 * Brazilian format: NNNNNNN-DD.AAAA.J.TT.OOOO (CNJ standard) or legacy formats.
 * UNIQUENESS: (organization_id, execution_process_number) must be unique when not null.
 * A duplicate process number within the same org triggers the merge workflow.
 * Architecture ref: ARCHITECTURE_RULES.md §D-04.
 *
 * TWO-CLOCK PRINCIPLE (execution-engine.md §0):
 * opened_at is the legal/operational open date — NOT the system creation timestamp.
 * This distinction matters for sentence arithmetic and deadline calculations.
 *
 * IMMUTABILITY:
 * id, organization_id, client_id, created_at, created_by_user_id are immutable.
 * All status transitions produce AuditLog entries.
 *
 * SENTENCE DATA LIVES IN SNAPSHOTS:
 * sentence_summary is a non-authoritative free-text field for human notes.
 * Authoritative sentence arithmetic lives in SentenceSnapshot (append-only).
 * The engine reads ONLY confirmed SentenceSnapshot records, never this field.
 * Architecture ref: ARCHITECTURE_RULES.md §D-03 (no unconfirmed data as engine input).
 *
 * PLAYBOOK COMPATIBILITY:
 * Every engine run against this case records playbook_version_id in the output
 * (SentenceSnapshot, Opportunity). This field carries no playbook data itself —
 * it's the case anchor for all playbook-governed computations.
 *
 * Architecture ref: data-model-v1.md §2.3, execution-workflows.md §2,
 *                   execution-engine.md §1, playbook-system.md §7.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { clients } from './client.ts'
import { users } from './user.ts'
import { caseStatusEnum, caseKindEnum } from './_enums-domain.ts'

export const executionCases = pgTable(
  'execution_cases',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable after creation
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Tenant isolation. Immutable after creation.
     * Architecture ref: ARCHITECTURE_RULES.md §M-01, §M-02.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The client this execution case belongs to.
     * Immutable after creation (cases are not transferred between clients).
     * If client merge happens, the case remains on the merged-from client but
     * the merged_into_client_id pointer allows disambiguation.
     */
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),

    // -------------------------------------------------------------------------
    // Process identification
    // -------------------------------------------------------------------------

    /**
     * Firm-internal case reference number.
     * Used before the court process number is known.
     * Format is office-defined (e.g., "EXE-2024-0042").
     * Unique per organization.
     */
    internalRef: text('internal_ref').notNull(),

    /**
     * Processo de execução penal — the court's identifier for this execution.
     * Format: CNJ standard (NNNNNNN-DD.AAAA.J.TT.OOOO) or legacy.
     * NULL when the process number is not yet known (intake state).
     *
     * UNIQUENESS: Unique per organization when not null.
     * A partial unique index (WHERE execution_process_number IS NOT NULL)
     * enforces this without blocking NULL values.
     *
     * ARCHITECTURE_RULES.md §D-04: duplicate process number requires merge workflow.
     */
    executionProcessNumber: text('execution_process_number'),

    /**
     * The originating conviction process number (processo de condenação).
     * Different from execution_process_number — this is the trial case number.
     * May be from another court or state. Used for document association.
     */
    originProcessNumber: text('origin_process_number'),

    // -------------------------------------------------------------------------
    // Court / jurisdiction
    // -------------------------------------------------------------------------

    /**
     * Name of the Vara de Execuções Criminais or equivalent court.
     * Example: "1ª VEP de São Paulo", "VEC de Campinas"
     */
    courtName: text('court_name'),

    /**
     * Comarca and state (UF) of the execution court.
     * Used for: SLA configuration, playbook jurisdiction selection.
     * Example: "São Paulo/SP", "Campinas/SP"
     */
    courtJurisdiction: text('court_jurisdiction'),

    // -------------------------------------------------------------------------
    // Case structure
    // -------------------------------------------------------------------------

    /**
     * Type of this execution case.
     * primary  → Main *execução penal* process.
     * apenso   → Apenso linked to a primary case.
     * incident → PAD or procedural incident.
     * parallel → Parallel execution (unificação pending or already done).
     * Architecture ref: execution-workflows.md §2.2.
     */
    caseKind: caseKindEnum('case_kind').notNull().default('primary'),

    /**
     * For apenso / linked procedures: the parent case ID.
     * NULL for primary cases and top-level incidents.
     * Cycle prevention: enforced at service layer (not DB — too complex for FK).
     */
    parentExecutionCaseId: uuid('parent_execution_case_id').references(
      (): AnyPgColumn => executionCases.id
    ),

    // -------------------------------------------------------------------------
    // Operational state
    // -------------------------------------------------------------------------

    /**
     * Case lifecycle status.
     * intake → active → suspended | closed → archived.
     * All transitions produce AuditLog entries.
     * Architecture ref: ARCHITECTURE_RULES.md §S-01.
     */
    status: caseStatusEnum('case_status').notNull().default('intake'),

    /**
     * The lawyer primarily responsible for this case.
     * May differ from client.responsible_lawyer_user_id (case reassignment is common).
     * Reassignment produces an AuditLog entry.
     */
    responsibleLawyerUserId: uuid('responsible_lawyer_user_id')
      .notNull()
      .references(() => users.id),

    // -------------------------------------------------------------------------
    // Non-authoritative sentence summary
    // -------------------------------------------------------------------------

    /**
     * Brief human-readable sentence summary.
     * NOT authoritative for arithmetic. Used for quick operational reference.
     * Example: "5 anos, regime fechado, crime hediondo"
     *
     * Authoritative data lives in SentenceSnapshot (append-only, engine-managed).
     * ARCHITECTURE_RULES.md §D-03: engine reads only confirmed snapshots.
     */
    sentenceSummary: text('sentence_summary'),

    // -------------------------------------------------------------------------
    // Temporal (legal open date vs system creation)
    // -------------------------------------------------------------------------

    /**
     * When this execution case was legally/operationally opened.
     * This is the LEGAL effective date — may predate the system creation timestamp.
     * Example: sentença trânsitada em julgado date, or initial prison entry date.
     *
     * TWO-CLOCK PRINCIPLE: opened_at ≠ created_at.
     * opened_at is legal time; created_at is system time.
     * The engine uses opened_at for deadline and fraction calculations.
     * Architecture ref: execution-engine.md §0 (two clocks).
     */
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),

    /**
     * When the case was closed. NULL for active cases.
     * Set when status transitions to 'closed'.
     */
    closedAt: timestamp('closed_at', { withTimezone: true }),

    /** Human-readable reason for closing the case. */
    closedReason: text('closed_reason'),

    /**
     * When the process number was determined to be pending.
     * Used for SLA monitoring: "case without process number for > 30 days."
     * Set automatically when case is created without execution_process_number.
     */
    processNumberPendingSince: timestamp('process_number_pending_since', {
      withTimezone: true,
    }),

    // -------------------------------------------------------------------------
    // Timestamps — immutable fields noted
    // -------------------------------------------------------------------------

    /** When this record was created in the system. Immutable. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Who created this case record. Immutable. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    /** Last time any mutable field was updated. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete timestamp.
     * STRONGLY DISCOURAGED if any filings, confirmed documents, or timeline events exist.
     * Prefer status='archived'. Use status='closed' for concluded cases.
     * ARCHITECTURE_RULES.md §D-01.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    /**
     * Process number uniqueness within org.
     * Partial unique index: only enforced when execution_process_number IS NOT NULL.
     * Null values are allowed (intake cases without process number).
     * ARCHITECTURE_RULES.md §D-04.
     */
    uniqueIndex('execution_cases_process_number_unique').on(
      table.organizationId,
      table.executionProcessNumber
    ),

    /**
     * Internal reference uniqueness within org.
     */
    uniqueIndex('execution_cases_internal_ref_unique').on(
      table.organizationId,
      table.internalRef
    ),

    /** Primary queue pattern: cases by status within org. */
    index('execution_cases_org_status_idx').on(table.organizationId, table.status),

    /** Cases by client. */
    index('execution_cases_client_idx').on(table.organizationId, table.clientId),

    /** Cases by responsible lawyer. */
    index('execution_cases_lawyer_idx').on(
      table.organizationId,
      table.responsibleLawyerUserId,
      table.status
    ),
  ]
)

export type ExecutionCase = typeof executionCases.$inferSelect
export type NewExecutionCase = typeof executionCases.$inferInsert
