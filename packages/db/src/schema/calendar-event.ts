/**
 * CalendarEvent — agenda própria do escritório (pedido do Miguel 13/07/2026).
 *
 * O calendário do ExecFlow mostra TRÊS coisas juntas:
 *   1. Eventos manuais criados aqui (audiência, reunião, lembrete, etc.).
 *   2. Prazos (deadlines) — sobrepostos ao vivo pela data de vencimento.
 *   3. Oportunidades (opportunities) — sobrepostas pela janela (windowEndAt).
 *
 * Só (1) vive NESTA tabela. (2) e (3) já têm data própria e são agregados na
 * leitura (ver routes/calendar.ts), sem duplicar dado. O botão "Adicionar à
 * agenda" num prazo/oportunidade cria uma linha aqui vinculada (sourceType +
 * sourceDeadlineId/sourceOpportunityId) — um lembrete fixado que o advogado
 * pode reintitular/remarcar sem mexer no prazo original.
 *
 * Decisão de arquitetura (nativo, não Google Calendar via MCP): dados de
 * execução penal dos clientes não saem pra terceiros; integração direta com
 * os prazos/oportunidades que já vivem no Postgres; funciona privado/offline.
 * Uma ponte .ics (assinatura só-leitura) pode ser adicionada depois sem expor
 * escrita nem enviar dado sensível.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { deadlines } from './deadline.ts'
import { opportunities } from './opportunity.ts'
import { users } from './user.ts'

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /** Caso vinculado, quando o evento é de um processo específico. Opcional. */
    executionCaseId: uuid('execution_case_id').references((): AnyPgColumn => executionCases.id),

    title: text('title').notNull(),
    description: text('description'),

    /** Início do evento. Para "dia inteiro", é a meia-noite (UTC) do dia. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** Fim, quando o evento tem duração. Null = evento pontual. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    allDay: boolean('all_day').notNull().default(true),

    location: text('location'),

    /**
     * Natureza do evento manual: 'manual' | 'hearing' (audiência) |
     * 'reminder' (lembrete) | 'meeting' (reunião) | 'internal' | 'deadline_link'
     * | 'opportunity_link'. Só afeta cor/rótulo — texto livre pra evoluir.
     */
    eventKind: text('event_kind').notNull().default('manual'),
    /** Cor opcional (hex/tailwind token) — sobrepõe a cor derivada de eventKind. */
    color: text('color'),

    /** Vínculo de origem: null | 'deadline' | 'opportunity'. */
    sourceType: text('source_type'),
    sourceDeadlineId: uuid('source_deadline_id').references((): AnyPgColumn => deadlines.id),
    sourceOpportunityId: uuid('source_opportunity_id').references((): AnyPgColumn => opportunities.id),

    createdByUserId: uuid('created_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('calendar_events_org_start_idx').on(table.organizationId, table.startsAt),
    index('calendar_events_case_idx').on(table.executionCaseId),
    index('calendar_events_source_deadline_idx').on(table.sourceDeadlineId),
    index('calendar_events_source_opportunity_idx').on(table.sourceOpportunityId),
  ]
)

export type CalendarEvent = typeof calendarEvents.$inferSelect
export type NewCalendarEvent = typeof calendarEvents.$inferInsert
