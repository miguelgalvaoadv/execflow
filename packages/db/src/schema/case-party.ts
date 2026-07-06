/**
 * CaseParty — partes e demais participantes de um processo.
 *
 * Em processo criminal a distinção importa MUITO: o mesmo PDF traz réu, corréu,
 * vítima, testemunha, MP e advogados — e o cadastro sugerido pela IA nunca pode
 * assumir que "o primeiro nome encontrado é o cliente". Esta tabela guarda todos
 * os participantes com o papel explícito; o vínculo Cliente↔Caso continua sendo
 * executionCases.clientId (o representado), e as demais pessoas ficam aqui.
 *
 * Origem rastreável: sourceDocumentId aponta o documento de onde a parte foi
 * extraída (quando veio da IA). Partes sugeridas pela IA nascem com
 * confidence='suggested' e só viram 'confirmed' após revisão humana.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { documents } from './document.ts'
import { users } from './user.ts'

export const caseParties = pgTable(
  'case_parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    /** Nome como consta nos autos. */
    name: text('name').notNull(),

    /**
     * Papel no processo:
     * 'reu' | 'correu' | 'autor' | 'vitima' | 'ministerio_publico' | 'advogado'
     * | 'assistente' | 'testemunha' | 'familiar' | 'outro'
     */
    participationType: text('participation_type').notNull(),

    /** CPF, se constar nos autos. LGPD-sensível — mesmo tratamento de clients.cpf. */
    cpf: text('cpf'),

    /** OAB (para advogados). Ex.: "123456/SP". */
    oab: text('oab'),

    /**
     * Confiabilidade do registro:
     * 'suggested' → extraído pela IA, aguardando conferência
     * 'confirmed' → conferido por humano
     */
    confidence: text('confidence').notNull().default('suggested'),

    /** Documento de origem, quando a parte foi extraída dos autos pela IA. */
    sourceDocumentId: uuid('source_document_id').references(() => documents.id),

    /** Página/folha de origem nos autos, quando conhecida. Ex.: "fl. 132". */
    sourceReference: text('source_reference'),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('case_parties_case_idx').on(table.executionCaseId, table.participationType),
    index('case_parties_org_idx').on(table.organizationId),
  ]
)

export type CaseParty = typeof caseParties.$inferSelect
export type NewCaseParty = typeof caseParties.$inferInsert
