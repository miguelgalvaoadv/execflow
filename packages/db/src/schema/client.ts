/**
 * Client — natural person under representation in *execução penal* matters.
 *
 * A Client is the human being whose liberty is at stake. This entity holds
 * legal identity, contact data, and operational attribution. Every ExecutionCase,
 * Document intake, and VisitNote ultimately traces back to a Client.
 *
 * LGPD SENSITIVITY:
 * Several fields are personal data under Brazilian LGPD (Lei 13.709/2018):
 * - cpf: CPF (Cadastro de Pessoa Física) — primary legal identifier. SENSITIVE.
 * - rg: RG (Registro Geral) — secondary identity document. SENSITIVE.
 * - birth_date: Date of birth. SENSITIVE.
 * - contact_channels: Phone, WhatsApp, email. SENSITIVE.
 *
 * These fields are restricted: only lawyer/admin role may read them (enforced
 * at service layer). All reads of sensitive fields are logged in AuditLog.
 * Architecture ref: ENGINEERING_PRINCIPLES.md §5 (auditability by default).
 *
 * IMMUTABILITY:
 * id, organization_id, created_at, created_by_user_id are immutable after creation.
 * Corrections to identity data (e.g., CPF correction) produce an AuditLog entry
 * with before/after snapshot — they are NOT silent mutations.
 * Architecture ref: ARCHITECTURE_RULES.md §D-02, ENGINEERING_PRINCIPLES.md §4.
 *
 * NO HARD DELETE:
 * Clients with any ExecutionCase, Document, VisitNote, or AuditLog history
 * are NEVER hard-deleted. Use status='archived' or 'merged' + soft delete.
 * Architecture ref: ARCHITECTURE_RULES.md §D-01, data-model-v1.md §2.1.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  date,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { users } from './user.ts'
import { clientStatusEnum } from './_enums-domain.ts'

export const clients = pgTable(
  'clients',
  {
    // -------------------------------------------------------------------------
    // Identity — immutable after creation
    // -------------------------------------------------------------------------

    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Tenant isolation. Immutable after creation.
     * Every client query MUST include organization_id in WHERE clause.
     * ARCHITECTURE_RULES.md §M-01.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    // -------------------------------------------------------------------------
    // Legal identity (LGPD-sensitive)
    // -------------------------------------------------------------------------

    /**
     * Full legal name as it appears on identity documents and court records.
     * Required for all clients. Used in petitions and legal filings.
     */
    fullName: text('full_name').notNull(),

    /**
     * CPF — Cadastro de Pessoa Física. Brazil's individual taxpayer identification number.
     * LGPD SENSITIVE: restrict reads to lawyer/admin role. Log all access.
     * Unique per organization when present (duplicates trigger merge workflow).
     * Null when CPF is not yet known (new intake without documentation).
     * data-model-v1.md §2.1: "Require cpf OR internal_ref."
     */
    cpf: text('cpf'),

    /**
     * RG — Registro Geral. Brazilian state identity card number.
     * LGPD SENSITIVE. Optional secondary identifier.
     */
    rg: text('rg'),

    /**
     * Matrícula do réu no sistema penitenciário (ex.: matrícula SAP).
     * Identifica o apenado no SEEU / unidade prisional. Opcional.
     */
    matricula: text('matricula'),

    /**
     * Date of birth. Used for legal age calculations and identity verification.
     * LGPD SENSITIVE. PostgreSQL `date` type (no time component needed).
     */
    birthDate: date('birth_date'),

    // -------------------------------------------------------------------------
    // Operational identity
    // -------------------------------------------------------------------------

    /**
     * Social/preferred name. May differ from legal name.
     * Used in internal interfaces for clarity. NOT used in legal filings.
     * Common for clients known by apelidos or social names.
     */
    displayName: text('display_name'),

    /**
     * Known aliases, apelidos, former names, or alternative spellings.
     * Stored as a JSON array of strings for search augmentation.
     * Format: ["Zé Pereira", "José da Silva Pereira (anterior)"]
     * Used for: search disambiguation, duplicate detection.
     */
    aliases: jsonb('aliases').notNull().default([]),

    /**
     * Internal firm reference number.
     * Required when CPF is not yet known (data-model-v1.md §2.1 constraint).
     * May follow office numbering convention (e.g., "EXE-2024-0042").
     * Unique per organization when present.
     */
    internalRef: text('internal_ref'),

    // -------------------------------------------------------------------------
    // Professional attribution
    // -------------------------------------------------------------------------

    /**
     * The lawyer primarily responsible for this client's matters.
     * Must hold 'lawyer' or 'admin' role in the organization.
     * Reassignment produces an AuditLog entry.
     */
    responsibleLawyerUserId: uuid('responsible_lawyer_user_id')
      .notNull()
      .references(() => users.id),

    // -------------------------------------------------------------------------
    // Contact (LGPD-sensitive)
    // -------------------------------------------------------------------------

    /**
     * Structured contact channels (phone, WhatsApp, email, address).
     * LGPD SENSITIVE: restrict reads. Log all access.
     * Format: [{ type: 'whatsapp', value: '+55...', notes: '...' }]
     * JSON structure allows flexible contact types without schema migration.
     */
    contactChannels: jsonb('contact_channels'),

    // -------------------------------------------------------------------------
    // Internal notes
    // -------------------------------------------------------------------------

    /**
     * Free-text internal summary notes about the client.
     * NOT a visit note (those are in visit_notes table).
     * NOT a legal narrative (that lives in timeline_events).
     * Mutable; changes produce AuditLog entries.
     */
    notes: text('notes'),

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Client status.
     * Transitions: active ↔ inactive; active → merged; any → archived.
     * Architecture ref: data-model-v1.md §2.1 lifecycle.
     */
    status: clientStatusEnum('status').notNull().default('active'),

    // -------------------------------------------------------------------------
    // Origem e validação do cadastro (cadastro sugerido pela IA)
    // -------------------------------------------------------------------------

    /**
     * Como este cadastro nasceu:
     * 'manual'       → digitado por humano (padrão)
     * 'ai_suggested' → sugerido pela IA a partir dos autos, aguardando validação
     * 'csv_import'   → importado de planilha
     * Cadastros 'ai_suggested' NÃO devem ser tratados como definitivos até
     * validatedAt ser preenchido — em processo criminal há vítima, corréu,
     * testemunha e homônimos.
     */
    registrationOrigin: text('registration_origin').notNull().default('manual'),

    /** Quem validou o cadastro sugerido. NULL = ainda não validado. */
    validatedByUserId: uuid('validated_by_user_id').references(() => users.id),

    /** Quando o cadastro foi validado por humano. */
    validatedAt: timestamp('validated_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Merge tracking
    // -------------------------------------------------------------------------

    /**
     * When status='merged': points to the surviving client record.
     * All future operations should use the merged_into_client_id record.
     * The merge workflow produces an AuditLog entry and optionally migrates FKs.
     * data-model-v1.md §2.1: "merged terminal (pointer to survivor)."
     */
    mergedIntoClientId: uuid('merged_into_client_id').references(
      (): AnyPgColumn => clients.id
    ),

    // -------------------------------------------------------------------------
    // Timestamps
    // -------------------------------------------------------------------------

    /** When this client record was created. Immutable. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Who created this client record.
     * Immutable after creation. Used for operational attribution.
     */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    /** Last time any mutable field was updated. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete timestamp. Use status='archived' preferably.
     * Only allowed when no ExecutionCase, Document, or VisitNote exists.
     * ARCHITECTURE_RULES.md §D-01: never hard-delete clients with history.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    /**
     * CPF uniqueness within organization.
     * Partial index: only when cpf is NOT NULL.
     * NULL cpf values do not violate uniqueness (pre-documentation clients).
     * Duplicate CPF within org triggers the merge workflow.
     * data-model-v1.md §2.1: "duplicate CPF blocked unless merge workflow."
     */
    uniqueIndex('clients_org_cpf_unique').on(table.organizationId, table.cpf),

    /** Filtered listing by status within org. Queue-first navigation. */
    index('clients_org_status_idx').on(table.organizationId, table.status),

    /** All clients for a lawyer. Used for workload view. */
    index('clients_lawyer_idx').on(table.organizationId, table.responsibleLawyerUserId),

    /** Internal reference lookup. */
    index('clients_internal_ref_idx').on(table.organizationId, table.internalRef),
  ]
)

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert
