import { pgTable, uuid, text, timestamp, jsonb, index, pgEnum } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'

export const caseAnalysisStatusEnum = pgEnum('case_analysis_status', [
  'pending',
  'running',
  'success',
  'failed',
])

/**
 * case_analysis_runs
 *
 * Rastreia execuções de "Analisar autos" (IA). A chamada ao Claude leva
 * 60-120s+ para PDFs reais — segurar a requisição HTTP até o fim atravessa
 * o proxy do Next.js (rewrites), que corta a conexão em requisições longas e
 * devolve "Internal Server Error" ao navegador mesmo quando o backend termina
 * com sucesso (achado 08/07/2026, testando o caso do Marcelo). Por isso a
 * rota /analyze responde 202 na hora e roda em segundo plano — o front faz
 * polling neste registro, igual ao padrão já usado em crawler_sync_logs.
 */
export const caseAnalysisRuns = pgTable(
  'case_analysis_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    executionCaseId: uuid('execution_case_id')
      .references(() => executionCases.id)
      .notNull(),

    status: caseAnalysisStatusEnum('status').default('pending').notNull(),

    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /** Preenchido em caso de sucesso: { snapshotId, resumoPena, oportunidadesCriadas, prazosCriados } */
    result: jsonb('result'),
    /** Preenchido em caso de falha. */
    errorDetails: text('error_details'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
  },
  (table) => [
    index('case_analysis_runs_org_status_idx').on(table.organizationId, table.status),
    index('case_analysis_runs_case_idx').on(table.executionCaseId, table.createdAt),
  ]
)

export type CaseAnalysisRun = typeof caseAnalysisRuns.$inferSelect
export type NewCaseAnalysisRun = typeof caseAnalysisRuns.$inferInsert
