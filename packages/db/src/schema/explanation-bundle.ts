/**
 * ExplanationBundle — structured legal explanation linked to engine outputs.
 *
 * Every rule-generated conclusion carries a structured ExplanationBundle that:
 * - References the playbook rules applied (by ruleId + version)
 * - Cites source documents and timeline events
 * - Explains calculations in plain language (not executable code)
 * - Lists uncertainty indicators and missing data
 * - Lists alternative interpretations when conflicts exist
 *
 * This record is the persistence layer for ExplanationBundle objects generated
 * by the engine's explanations/generator.ts module.
 *
 * BUNDLE PAYLOAD STRUCTURE (stored in 'payload' JSONB):
 * {
 *   summary: string,                   // One paragraph plain language
 *   conclusionType: 'opportunity' | 'deadline' | 'warning' | 'snapshot_proposal',
 *   playbookVersion: { id, label, effectiveFrom },
 *   legalRulesApplied: [{
 *     ruleId, playbookVersionId, branchId?, citationRef, parameters
 *   }],
 *   calculations: [{
 *     name, inputs: Record<string, unknown>, output, confidence, derivationNote
 *   }],
 *   sourceDocuments: [{ documentId, fieldPaths, spans }],
 *   sourceEvents: [{ timelineEventId, eventType }],
 *   missingData: [{ field, whyNeeded, severity: 'critical'|'recommended'|'optional' }],
 *   uncertaintyIndicators: [{ code, message, affectedOutputs }],
 *   blockingCodes: string[],
 *   alternatives: [{ interpretationId, label, outcome, branchId }]
 * }
 *
 * NOTE: calculations[] contains DESCRIPTIVE text only. Never executable code.
 * Architecture ref: execution-engine.md §8 (explainability mandate),
 *                   execution-engine.md §8.3 (calculations descriptive only).
 *
 * Architecture ref: execution-engine.md §8.
 */

import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { engineRuns } from './engine-run.ts'

export const explanationBundles = pgTable(
  'explanation_bundles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The engine run that generated this explanation.
     */
    engineRunId: uuid('engine_run_id')
      .notNull()
      .references(() => engineRuns.id),

    // -------------------------------------------------------------------------
    // Target entity — what this explanation is FOR
    // -------------------------------------------------------------------------

    /**
     * Type of entity this explanation is attached to.
     * Typically: 'opportunity', 'deadline', 'snapshot_proposal', 'engine_run'
     */
    targetEntityType: text('target_entity_type').notNull(),

    /**
     * ID of the entity (Opportunity.id, Deadline.id, SentenceSnapshot.id, etc.)
     */
    targetEntityId: uuid('target_entity_id').notNull(),

    // -------------------------------------------------------------------------
    // Conclusion type
    // -------------------------------------------------------------------------

    conclusionType: text('conclusion_type').notNull(),

    // -------------------------------------------------------------------------
    // Full bundle payload (see JSDoc header for schema)
    // -------------------------------------------------------------------------

    /**
     * The complete ExplanationBundle JSON object.
     * Deterministic: same inputs + same rules → same payload.
     * NOT executable code. Human-readable calculations only.
     */
    payload: jsonb('payload').notNull(),

    // -------------------------------------------------------------------------
    // Denormalized indexes for fast retrieval
    // -------------------------------------------------------------------------

    /**
     * Playbook version used (denormalized from payload for efficient querying).
     */
    playbookVersionId: uuid('playbook_version_id').notNull(),

    /**
     * Rule IDs applied (denormalized from payload for filtering).
     * JSON: string[]
     */
    ruleIdsApplied: jsonb('rule_ids_applied').notNull().default([]),

    // -------------------------------------------------------------------------
    // APPEND-ONLY — no updated_at, no deleted_at
    // -------------------------------------------------------------------------
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * LOOKUP: explanation for a specific entity.
     * pattern: WHERE target_entity_type = ? AND target_entity_id = ?
     */
    index('explanation_bundles_entity_idx').on(
      table.targetEntityType,
      table.targetEntityId
    ),
    index('explanation_bundles_run_idx').on(table.engineRunId),
    index('explanation_bundles_org_idx').on(table.organizationId),
  ]
)

export type ExplanationBundle = typeof explanationBundles.$inferSelect
export type NewExplanationBundle = typeof explanationBundles.$inferInsert
