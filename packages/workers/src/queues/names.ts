/**
 * Canonical pg-boss queue names used across the workers package.
 *
 * NAMING CONVENTION:
 * - DomainEvent queues: mirror the event type (e.g., 'deadline.created')
 * - SLA sweep jobs:     prefix 'sla.' (e.g., 'sla.overdue-sweep')
 * - System jobs:        prefix 'system.' (e.g., 'system.outbox-relay')
 *
 * These names appear in pg-boss tables and in monitoring dashboards.
 * Do not change a name without a coordinated deployment — in-flight
 * jobs from the old name will not be picked up by workers using the new name.
 *
 * Architecture ref: event-state-architecture.md §2.1 (event taxonomy).
 */

// ---------------------------------------------------------------------------
// Outbox relay job
// ---------------------------------------------------------------------------

export const QUEUE_OUTBOX_RELAY = 'system.outbox-relay'

// ---------------------------------------------------------------------------
// DomainEvent consumer queues
// Names must match the eventType values written to domain_events.event_type
// ---------------------------------------------------------------------------

// Deadline events
export const QUEUE_DEADLINE_CREATED = 'deadline.created'
export const QUEUE_DEADLINE_ACKNOWLEDGED = 'deadline.acknowledged'
export const QUEUE_DEADLINE_COMPLETED = 'deadline.completed'
export const QUEUE_DEADLINE_DISMISSED = 'deadline.dismissed'
export const QUEUE_DEADLINE_OVERDUE = 'deadline.overdue'

// Opportunity events
export const QUEUE_OPPORTUNITY_CREATED = 'opportunity.created'
export const QUEUE_OPPORTUNITY_QUALIFIED = 'opportunity.qualified'
export const QUEUE_OPPORTUNITY_DISMISSED = 'opportunity.dismissed'
export const QUEUE_OPPORTUNITY_REVIEWED = 'opportunity.reviewed'
export const QUEUE_OPPORTUNITY_DEFERRED = 'opportunity.deferred'

// Intake / document events
export const QUEUE_INTAKE_REGISTERED = 'intake.registered'
export const QUEUE_DOCUMENT_ASSOCIATED = 'document.associated'
export const QUEUE_DOCUMENT_CONFIRMED = 'document.confirmed'
export const QUEUE_DOCUMENT_REGISTERED = 'document.registered'

// OCR pipeline events
export const QUEUE_OCR_REQUESTED = 'ocr.requested'
export const QUEUE_OCR_COMPLETED = 'ocr.completed'

// Extraction pipeline events
export const QUEUE_EXTRACTION_REQUESTED = 'extraction.requested'

// Snapshot promotion events
export const QUEUE_SNAPSHOT_PROMOTION_REQUESTED = 'snapshot.promotion.requested'
export const QUEUE_SNAPSHOT_CONFIRMED = 'snapshot.confirmed'

// Timeline events
export const QUEUE_TIMELINE_EVENT_APPENDED = 'timeline.event.appended'

// Sentence snapshot events (Phase 7 — engine triggers)
export const QUEUE_SENTENCE_SNAPSHOT_SUPERSEDED = 'sentence.snapshot.superseded'

// Custody snapshot events (Phase 7 — engine triggers)
export const QUEUE_CUSTODY_SNAPSHOT_CREATED = 'custody.snapshot.created'

// Engine computation events (Phase 7)
export const QUEUE_ENGINE_EVALUATION_REQUESTED = 'engine.evaluation.requested'

/**
 * FUTURE: no producer or consumer registered yet.
 * Recalculation lifecycle is driven via engine.evaluation.requested today.
 */
export const QUEUE_ENGINE_RECALCULATION_SCHEDULED = 'engine.recalculation.scheduled'

export const QUEUE_ENGINE_RUN_COMPLETED = 'engine.run.completed'

// Sincronização com o Escavador (motor único de tribunais)
export const QUEUE_DAILY_CRAWLER_SWEEP = 'crawler.daily-sweep'
export const QUEUE_CRAWLER_SYNC_REQUESTED = 'crawler.sync.requested'

// Astrea — monitoramento de tribunais via e-mail (IMAP)
export const QUEUE_ASTREA_EMAIL_POLL = 'astrea.email-poll'
export const QUEUE_SYSTEM_HEALTH_SWEEP = 'system.astrea-health-sweep'

// Inventário por OAB — enriquecimento diário via DataJud (metadados públicos)
export const QUEUE_INVENTORY_ENRICHMENT = 'inventory.datajud-enrichment'

// DataJud → caso: sync de movimentações dos casos promovidos + reanálise
export const QUEUE_DATAJUD_CASE_SYNC = 'datajud.case-sync'

// DJEN → intimações oficiais por OAB (Comunica/PJe) + reanálise
export const QUEUE_DJEN_SYNC = 'djen.intimacoes-sync'

// InfoSimples → descoberta por OAB (TJSP e-SAJ) — opt-in, desligada por padrão (ver worker-registry.ts)
export const QUEUE_INFOSIMPLES_SYNC = 'infosimples.oab-sync'

// InfoSimples → monitoramento só dos casos já cadastrados (curado), por CNJ, 1x/dia
export const QUEUE_INFOSIMPLES_CURATED_SYNC = 'infosimples.curated-case-sync'

// Lembrete recorrente pra casos em segredo de justiça (nem InfoSimples nem
// DJEN leem esses — precisa de conferência manual periódica)
export const QUEUE_SEALED_CASE_REMINDER_SWEEP = 'sealed-case.reminder-sweep'

// WhatsApp Notifier
export const QUEUE_WHATSAPP_NOTIFICATION_REQUESTED = 'whatsapp.notification.requested'

// ---------------------------------------------------------------------------
// SLA and escalation sweep jobs (cron-triggered via pg-boss schedule)
// ---------------------------------------------------------------------------

/** Detect deadlines past due_at; update status to overdue */
export const QUEUE_SLA_OVERDUE_SWEEP = 'sla.overdue-sweep'

/** Wake up snoozed queue projections whose snooze_until has passed */
export const QUEUE_SLA_SNOOZE_WAKE = 'sla.snooze-wake'

/** Wake up deferred queue projections */
export const QUEUE_SLA_DEFER_WAKE = 'sla.defer-wake'

/** Detect queue items past SLA; escalate if not resolved */
export const QUEUE_SLA_ESCALATION_SWEEP = 'sla.escalation-sweep'

/** Detect stale workflow tasks (no activity past stale_threshold) */
export const QUEUE_SLA_STALE_TASK_SWEEP = 'sla.stale-task-sweep'

// ---------------------------------------------------------------------------
// All DomainEvent queues for consumer registration
// ---------------------------------------------------------------------------

export const DOMAIN_EVENT_QUEUES = [
  QUEUE_DEADLINE_CREATED,
  QUEUE_DEADLINE_ACKNOWLEDGED,
  QUEUE_DEADLINE_COMPLETED,
  QUEUE_DEADLINE_DISMISSED,
  QUEUE_DEADLINE_OVERDUE,
  QUEUE_OPPORTUNITY_CREATED,
  QUEUE_OPPORTUNITY_QUALIFIED,
  QUEUE_OPPORTUNITY_DISMISSED,
  QUEUE_OPPORTUNITY_REVIEWED,
  QUEUE_OPPORTUNITY_DEFERRED,
  QUEUE_INTAKE_REGISTERED,
  QUEUE_DOCUMENT_ASSOCIATED,
  QUEUE_DOCUMENT_CONFIRMED,
  QUEUE_DOCUMENT_REGISTERED,
  QUEUE_OCR_REQUESTED,
  QUEUE_OCR_COMPLETED,
  QUEUE_EXTRACTION_REQUESTED,
  QUEUE_SNAPSHOT_PROMOTION_REQUESTED,
  QUEUE_SNAPSHOT_CONFIRMED,
  QUEUE_TIMELINE_EVENT_APPENDED,
  QUEUE_SENTENCE_SNAPSHOT_SUPERSEDED,
  QUEUE_CUSTODY_SNAPSHOT_CREATED,
  QUEUE_ENGINE_EVALUATION_REQUESTED,
  QUEUE_ENGINE_RECALCULATION_SCHEDULED,
  QUEUE_ENGINE_RUN_COMPLETED,
  QUEUE_CRAWLER_SYNC_REQUESTED,
  QUEUE_WHATSAPP_NOTIFICATION_REQUESTED,
] as const
