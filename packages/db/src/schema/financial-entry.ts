/**
 * FinancialEntry — ledger financeiro manual por cliente (módulo Financeiro,
 * pedido do Miguel 14/07/2026).
 *
 * Cobre as duas pontas de um controle financeiro de escritório de advocacia:
 *   - direction='receivable' → o que o cliente deve/pagou (honorário contratado,
 *     parcela, pagamento avulso, êxito).
 *   - direction='expense'    → o que o escritório gastou no processo do cliente
 *     (custas, diligência, cópia, deslocamento) — só registrado se for
 *     repassável/reembolsável ao cliente; despesa operacional do escritório em
 *     si não entra aqui.
 *
 * category é texto livre (não enum) de propósito: mercado jurídico usa dezenas
 * de nomenclaturas de honorário (fixo, êxito, hora, pro labore, ad exitum) e
 * uma nova categoria não deve exigir migração de schema.
 *
 * status='pending' + dueDate no passado = "atrasado" computado na leitura
 * (routes/finance.ts), não armazenado — evita ficar desatualizado sem cron.
 *
 * clientId é a chave de particionamento primária (não executionCaseId): o
 * relacionamento financeiro é com o cliente, não com um processo específico.
 * executionCaseId é opcional, só quando faz sentido vincular a um processo.
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { clients } from './client.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'

export const financialEntries = pgTable(
  'financial_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    clientId: uuid('client_id')
      .notNull()
      .references((): AnyPgColumn => clients.id),

    /** Vínculo opcional a um processo específico do cliente. */
    executionCaseId: uuid('execution_case_id').references((): AnyPgColumn => executionCases.id),

    /** 'receivable' (a receber/recebido do cliente) | 'expense' (despesa do processo). */
    direction: text('direction').notNull(),

    /** Texto livre: 'honorario_contratado' | 'parcela' | 'pagamento_avulso' | 'exito' | 'custas_processuais' | 'diligencia' | 'deslocamento' | 'outro' etc. */
    category: text('category').notNull(),

    description: text('description').notNull(),

    /** Valor em reais (BRL). Sempre positivo — o direction indica o sentido. */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),

    /** Data de vencimento/previsão. Null = sem prazo definido (ex.: despesa já paga). */
    dueDate: date('due_date'),

    /** Quando foi efetivamente pago/recebido. Null = ainda pendente. */
    paidAt: timestamp('paid_at', { withTimezone: true }),

    /** 'pix' | 'dinheiro' | 'transferencia' | 'cartao_credito' | 'cartao_debito' | 'boleto' | 'cheque' | 'outro'. Null até ser pago. */
    paymentMethod: text('payment_method'),

    /** 'pending' | 'paid' | 'cancelled'. "Atrasado" é computado (pending + dueDate < hoje). */
    status: text('status').notNull().default('pending'),

    /**
     * Observação — sempre disponível, anotação livre do advogado sobre o
     * lançamento (ex.: "combinado por WhatsApp", "aguardando repasse do INSS").
     */
    notes: text('notes'),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('financial_entries_org_client_idx').on(table.organizationId, table.clientId),
    index('financial_entries_org_status_due_idx').on(table.organizationId, table.status, table.dueDate),
    index('financial_entries_case_idx').on(table.executionCaseId),
  ]
)

export type FinancialEntry = typeof financialEntries.$inferSelect
export type NewFinancialEntry = typeof financialEntries.$inferInsert
