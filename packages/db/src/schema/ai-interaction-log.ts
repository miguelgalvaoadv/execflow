/**
 * AiInteractionLog — trilha de auditoria de TODA interação com a IA.
 *
 * Requisito LGPD/auditabilidade: cada chamada ao Claude (extração, classificação,
 * detecção de oportunidade, atualização incremental, geração de minuta) produz
 * exatamente uma linha aqui — sucesso ou erro. Permite responder:
 *   "que prompt gerou esta minuta?", "quanto custou este mês?",
 *   "qual modelo/versão produziu esta sugestão?".
 *
 * SANITIZAÇÃO: promptText/responseText podem conter dados sensíveis dos autos —
 * o acesso à tela de histórico é restrito a lawyer/admin (service layer), igual
 * aos campos LGPD-sensíveis de clients. A API key NUNCA aparece aqui.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  index,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { clients } from './client.ts'
import { documents } from './document.ts'

export const aiInteractionLogs = pgTable(
  'ai_interaction_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * Agente que fez a chamada:
     * 'extractor'           → extração objetiva de dados dos autos
     * 'phase_classifier'    → classificação de fase processual
     * 'strategic_reader'    → leitura estratégica (teses, riscos, oportunidades)
     * 'deadline_spotter'    → identificação de evento gerador de prazo
     * 'updater'             → comparação incremental antigo × novo
     * 'draft_generator'     → geração de minuta
     * 'movement_classifier' → criticidade de movimentação (tier 1/2/3)
     * 'email_parser'        → fallback de parsing de e-mail (Haiku)
     * 'sentence_calculator' → cálculo de pena a partir dos autos
     */
    agent: text('agent').notNull(),

    /** Modelo usado. Ex.: 'claude-sonnet-4-6', 'claude-haiku-4-5'. */
    model: text('model').notNull(),

    /** Prompt enviado (system + user concatenados ou resumidos quando gigantes). */
    promptText: text('prompt_text'),

    /** Resposta bruta do modelo. */
    responseText: text('response_text'),

    // Vínculos opcionais para navegação
    executionCaseId: uuid('execution_case_id').references(() => executionCases.id),
    clientId: uuid('client_id').references(() => clients.id),
    documentId: uuid('document_id').references(() => documents.id),

    /** Tokens, quando a API informa. */
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),

    /** Custo estimado em USD (calculado pela tabela de preço do modelo). */
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }),

    /** 'success' | 'error'. */
    status: text('status').notNull(),

    errorMessage: text('error_message'),

    /** Duração da chamada em milissegundos. */
    durationMs: integer('duration_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_interaction_logs_org_created_idx').on(
      table.organizationId,
      table.createdAt
    ),
    index('ai_interaction_logs_case_idx').on(table.executionCaseId),
    index('ai_interaction_logs_agent_idx').on(table.organizationId, table.agent),
  ]
)

export type AiInteractionLog = typeof aiInteractionLogs.$inferSelect
export type NewAiInteractionLog = typeof aiInteractionLogs.$inferInsert
