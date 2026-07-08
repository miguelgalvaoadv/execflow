/**
 * ClientNote — anotações livres do advogado sobre um cliente.
 *
 * Bloquinho de observações: cada anotação é um registro separado (não um
 * campo único que se sobrescreve), com autor e data, editável e excluível
 * pelo autor. Diferente de `clients.notes` (campo único legado, resumo
 * interno) — aqui é histórico de "lembretes" ao longo do acompanhamento.
 */

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { clients } from './client.ts'
import { users } from './user.ts'

export const clientNotes = pgTable(
  'client_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),

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
    index('client_notes_client_idx').on(table.clientId, table.createdAt),
    index('client_notes_org_idx').on(table.organizationId),
  ]
)

export type ClientNote = typeof clientNotes.$inferSelect
export type NewClientNote = typeof clientNotes.$inferInsert
