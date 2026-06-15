import { pgTable, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'

/**
 * ExplanationBundle
 * 
 * Reusable JSON payload detailing the rationale and provenance of an engine action.
 * Separated from Opportunities, Deadlines, etc., to allow polymorphism without duplication.
 *
 * Payload schema:
 * {
 *   summary: string,
 *   legalFoundations: Array<{ citation: string, playbookRuleId: string, playbookBranch: string }>,
 *   factsUsed: Array<{ description: string, sourceEntity: string, sourceId: string }>,
 *   mathTrace: Array<{ step: string, formula: string, result: string }>,
 *   missingData: Array<{ field: string, impact: string }>,
 *   confidence: 'high' | 'medium' | 'low' | 'unknown'
 * }
 */
export const explanationBundles = pgTable(
  'explanation_bundles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    executionCaseId: uuid('execution_case_id')
      .notNull()
      .references(() => executionCases.id),

    /**
     * Engine run that produced this explanation.
     * Null if created manually by a lawyer.
     */
    engineRunId: uuid('engine_run_id'),

    /**
     * The actual explanation JSON.
     */
    payload: jsonb('payload').notNull(),

    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('explanation_bundles_case_idx').on(table.executionCaseId),
    index('explanation_bundles_engine_run_idx').on(table.engineRunId),
  ]
)

export type ExplanationBundle = typeof explanationBundles.$inferSelect
export type NewExplanationBundle = typeof explanationBundles.$inferInsert
