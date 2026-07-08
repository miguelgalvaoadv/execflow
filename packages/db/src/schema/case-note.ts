/**
 * CaseNote — anotações livres do advogado sobre um processo (execução).
 *
 * Bloquinho de observações: cada anotação é um registro separado (não um
 * campo único que se sobrescreve), com autor e data, editável e excluível
 * pelo autor. Vinculada à execução (não ao cliente) porque um cliente pode
 * ter mais de um processo — a observação é sobre o processo específico,
 * junto de Prazos/Movimentações/Cálculos na tela do caso.
 */

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'

export const caseNotes = pgTable(
  'case_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    body: text('body').notNull(),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Preenchido só se a nota foi editada depois de criada. */
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('case_notes_case_idx').on(table.executionCaseId, table.createdAt),
    index('case_notes_org_idx').on(table.organizationId),
  ]
)

export type CaseNote = typeof caseNotes.$inferSelect
export type NewCaseNote = typeof caseNotes.$inferInsert
