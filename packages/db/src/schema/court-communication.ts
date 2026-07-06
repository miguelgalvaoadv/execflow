/**
 * CourtCommunication — intimações, publicações e comunicações oficiais.
 *
 * SEPARAÇÃO DE FONTES (regra central do painel): "autos anexados", "movimentação
 * pública" e "intimação/publicação" são coisas DIFERENTES:
 *   - autos          → documents (conteúdo integral, alimenta análise profunda)
 *   - movimentações  → timeline_events (metadado do andamento)
 *   - intimações     → ESTA tabela (comunicação oficial dirigida ao advogado,
 *                      com as três datas que importam para prazo: disponibilização,
 *                      publicação e ciência)
 *
 * Uma intimação pode gerar prazo — mas o cálculo é do motor determinístico
 * (deadlines + engine), nunca daqui. Aqui fica o FATO da comunicação com
 * proveniência e dedup por hash, alimentado por AASP (webhook), Astrea (e-mail),
 * DJE/DJEN (quando configurado) ou registro manual.
 *
 * Órfãs (processo não encontrado) ficam com status='orphan' e aparecem na
 * triagem — nada é descartado silenciosamente (mesmo contrato do astrea_email_logs).
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { inventoryItems } from './oab-inventory.ts'
import { users } from './user.ts'

export const courtCommunications = pgTable(
  'court_communications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /** Caso operacional vinculado. NULL enquanto órfã. */
    executionCaseId: uuid('execution_case_id').references(() => executionCases.id),

    /** Item do inventário vinculado (processo ainda não promovido a caso). */
    inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id),

    /** Número CNJ extraído da comunicação (mesmo quando órfã). */
    processNumber: text('process_number'),

    /**
     * Natureza: 'intimacao' | 'publicacao' | 'citacao' | 'notificacao' | 'comunicacao'.
     */
    kind: text('kind').notNull().default('intimacao'),

    /**
     * Fonte: 'aasp' | 'astrea_email' | 'dje' | 'djen' | 'domicilio_eletronico' | 'manual'.
     */
    source: text('source').notNull(),

    /** Conteúdo/texto da comunicação como recebido. */
    content: text('content'),

    /** Advogado destinatário, como veio da fonte. */
    lawyerName: text('lawyer_name'),

    // -------------------------------------------------------------------------
    // As três datas que importam para contagem de prazo
    // -------------------------------------------------------------------------

    /** Data de DISPONIBILIZAÇÃO no diário (dia em que entrou no sistema). */
    availableAt: timestamp('available_at', { withTimezone: true }),

    /** Data de PUBLICAÇÃO (normalmente 1º dia útil após a disponibilização). */
    publishedAt: timestamp('published_at', { withTimezone: true }),

    /** Data de CIÊNCIA (intimação pessoal/eletrônica com ciência expressa). */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Ligação com prazo
    // -------------------------------------------------------------------------

    /** Heurística: esta comunicação provavelmente abre prazo (dispara prazo provisório). */
    possibleDeadline: boolean('possible_deadline').notNull().default(false),

    /** Prazo provisório criado a partir desta comunicação, se houver. */
    deadlineId: uuid('deadline_id'),

    // -------------------------------------------------------------------------
    // Ciclo de vida
    // -------------------------------------------------------------------------

    /**
     * 'new'       → recebida, ainda não processada/vista
     * 'processed' → vinculada a caso/inventário e tratada
     * 'orphan'    → processo não encontrado — precisa de triagem manual
     * 'dismissed' → conferida e marcada como irrelevante
     */
    status: text('status').notNull().default('new'),

    /** Payload bruto da fonte (webhook AASP, e-mail parseado etc.). */
    rawPayload: jsonb('raw_payload'),

    /** Dedup: sha-256 do conteúdo normalizado + processo + data. */
    contentHash: text('content_hash').notNull(),

    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('court_communications_hash_unique').on(
      table.organizationId,
      table.contentHash
    ),
    index('court_communications_case_idx').on(table.executionCaseId, table.status),
    index('court_communications_org_status_idx').on(
      table.organizationId,
      table.status,
      table.kind
    ),
    index('court_communications_process_idx').on(
      table.organizationId,
      table.processNumber
    ),
  ]
)

export type CourtCommunication = typeof courtCommunications.$inferSelect
export type NewCourtCommunication = typeof courtCommunications.$inferInsert
