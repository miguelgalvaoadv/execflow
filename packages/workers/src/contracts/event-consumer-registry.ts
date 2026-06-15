/**
 * Domain event consumer registry — documents which events have active consumers.
 *
 * FUTURE entries have a registered producer or planned consumer but no handler yet.
 * ORPHAN entries are listed in queues/names.ts DOMAIN_EVENT_QUEUES without a worker.
 *
 * See docs/document-layer-event-wiring-report.md for the full audit table.
 */

/** Events with no consumer — producer exists; handler deferred to a future phase. */
export const FUTURE_DOCUMENT_LAYER_CONSUMERS = [
  /** Search index refresh on document registration. */
  'document.registered',
  /** Resolve queue projections / audit on archive. */
  'document.archived',
  /** Producer deferred until extraction confirm API (Phase 5+). Consumer exists. */
  'document.confirmed',
  /** UI review queue for proposed sentence snapshots. */
  'sentence.snapshot.proposed',
  /** Custody supersede recalculation — mirror sentence path. */
  'custody.snapshot.superseded',
] as const

/** Queue names reserved in DOMAIN_EVENT_QUEUES without boss.work registration. */
export const ORPHAN_EVENT_QUEUES = [
  /** Superseded by engine.evaluation.requested transactional outbox flow. */
  'engine.recalculation.scheduled',
] as const

export type FutureDocumentLayerConsumer = (typeof FUTURE_DOCUMENT_LAYER_CONSUMERS)[number]
export type OrphanEventQueue = (typeof ORPHAN_EVENT_QUEUES)[number]
