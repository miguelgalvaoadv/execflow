/**
 * SnapshotDependency — dependency graph for engine run inputs.
 *
 * Records exactly which confirmed snapshots, timeline events, and documents
 * an EngineRun consumed as inputs. This enables:
 *
 * 1. STALE DETECTION: when a dependency changes (e.g., SentenceSnapshot superseded),
 *    find all EngineRuns that depended on it → mark as stale → schedule recalculation.
 *
 * 2. REPLAY VERIFICATION: replay the same EngineRun and confirm it consumed the
 *    same dependencies → determinism invariant holds.
 *
 * 3. DEPENDENCY INVALIDATION: when a PlaybookVersion is retired, find all runs
 *    that used it → schedule re-evaluation with the new version.
 *
 * APPEND-ONLY: dependency records are created when an EngineRun commits.
 * Never modified. When a dependency changes, new recalculation runs are created.
 *
 * Architecture ref: execution-engine.md §7 (historical replay),
 *                   execution-engine.md §1.6 (recalculation events).
 */

import { pgTable, uuid, text, timestamp, boolean, index } from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { engineRuns } from './engine-run.ts'
import { snapshotDependencyTypeEnum } from './_enums-engine.ts'

export const snapshotDependencies = pgTable(
  'snapshot_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /**
     * The EngineRun that consumed this dependency.
     */
    engineRunId: uuid('engine_run_id')
      .notNull()
      .references(() => engineRuns.id),

    // -------------------------------------------------------------------------
    // Dependency identity
    // -------------------------------------------------------------------------

    dependencyType: snapshotDependencyTypeEnum('dependency_type').notNull(),

    /**
     * ID of the dependency entity (SentenceSnapshot.id, TimelineEvent.id, etc.)
     */
    dependencyEntityId: uuid('dependency_entity_id').notNull(),

    /**
     * The effective_at of the snapshot or event at dependency time.
     * Enables point-in-time queries: "what did the engine see at instant T?"
     */
    dependencyEffectiveAt: timestamp('dependency_effective_at', { withTimezone: true }),

    /**
     * The version/hash of the dependency at time of consumption.
     * For snapshots: status at consumption time ('confirmed').
     * For playbook: content_hash.
     * Used to detect if the dependency has changed (stale detection).
     */
    dependencyVersion: text('dependency_version'),

    // -------------------------------------------------------------------------
    // Staleness tracking
    // -------------------------------------------------------------------------

    /**
     * Whether this dependency has been invalidated (source entity changed).
     * Set to true when: SentenceSnapshot superseded, PlaybookVersion retired,
     * TimelineEvent amended, etc.
     */
    isStale: boolean('is_stale').notNull().default(false),

    /**
     * When this dependency was marked stale.
     */
    staledAt: timestamp('staled_at', { withTimezone: true }),

    /**
     * Why this dependency was invalidated.
     * Examples: 'snapshot_superseded', 'playbook_retired', 'event_amended'
     */
    staleReason: text('stale_reason'),

    // -------------------------------------------------------------------------
    // APPEND-ONLY — no updated_at, no deleted_at
    // -------------------------------------------------------------------------
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * PRIMARY QUERY: all dependencies for an engine run.
     * pattern: WHERE engine_run_id = ?
     */
    index('snapshot_dependencies_run_idx').on(table.engineRunId),

    /**
     * STALE DETECTION: find all runs that depended on a specific entity.
     * pattern: WHERE dependency_type = ? AND dependency_entity_id = ?
     * Used when: a SentenceSnapshot is superseded → find affected runs.
     */
    index('snapshot_dependencies_entity_idx').on(
      table.dependencyType,
      table.dependencyEntityId
    ),

    /**
     * STALE SWEEP: find all stale dependencies.
     * pattern: WHERE is_stale = true AND org = ?
     */
    index('snapshot_dependencies_stale_idx').on(table.organizationId, table.isStale),
  ]
)

export type SnapshotDependency = typeof snapshotDependencies.$inferSelect
export type NewSnapshotDependency = typeof snapshotDependencies.$inferInsert
