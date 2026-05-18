-- ============================================================================
-- Migration 0005: Queue projections and workflow orchestration
-- Phase 6: Queue engine and workflow orchestration
--
-- Creates:
--   ENUMS:  queue_type, queue_projection_status,
--           workflow_task_status, workflow_task_type,
--           escalation_trigger
--
--   TABLES: queue_projections      (mutable — materialized queue view)
--           workflow_tasks          (mutable — operational task lifecycle)
--           queue_assignments       (append-only — ownership change history)
--           queue_escalations       (append-only — escalation history)
--
-- DESIGN NOTES:
-- - queue_projections and workflow_tasks are mutable and get updated_at triggers.
-- - queue_assignments and queue_escalations are append-only: no updated_at,
--   no deleted_at, no UPDATE triggers.
-- - queue_projections has a UNIQUE constraint (org + queue_type + entity_type + entity_id)
--   to enforce idempotent consumer writes ("upsert by natural key").
-- - All indexes are named for their query pattern per project convention.
-- ============================================================================

BEGIN;

-- ============================================================================
-- ENUMS
-- ============================================================================

-- queue_type: named operational queues from office-operating-system.md §2.1
CREATE TYPE queue_type AS ENUM (
  'intake_review',
  'extraction_review',
  'missing_data',
  'progression_opportunities',
  'pad_defense',
  'overdue_deadlines',
  'pending_filings',
  'recalculation_conflicts',
  'ai_review',
  'urgent_liberty_risks',
  'opportunity_review',
  'workflow_tasks'
);

-- queue_projection_status: lifecycle states for a queue projection entry
-- Terminal state: resolved
CREATE TYPE queue_projection_status AS ENUM (
  'active',
  'snoozed',
  'deferred',
  'blocked',
  'resolved'
);

-- workflow_task_status: lifecycle states for an operational task
-- Terminal states: completed, cancelled
CREATE TYPE workflow_task_status AS ENUM (
  'pending',
  'claimed',
  'released',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
  'escalated'
);

-- workflow_task_type: functional categories of operational tasks
CREATE TYPE workflow_task_type AS ENUM (
  'review_extraction',
  'confirm_document',
  'prepare_piece',
  'collect_missing_data',
  'confirm_filing',
  'review_opportunity',
  'case_health_review',
  'deadline_action',
  'intake_triage',
  'follow_up',
  'recalculation_review',
  'pad_defense',
  'generic'
);

-- escalation_trigger: what triggered an escalation record
CREATE TYPE escalation_trigger AS ENUM (
  'sla_breach',
  'overdue_legal',
  'liberty_risk',
  'unacknowledged',
  'blocking_unresolved',
  'manual',
  'repeated_failure'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- queue_projections
--
-- Materialized, replay-safe projection of queue items.
-- Mutable: updated by event consumers and SLA sweeps.
-- UNIQUE constraint enforces idempotent consumer writes.
-- ----------------------------------------------------------------------------

CREATE TABLE queue_projections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant isolation
  organization_id         UUID NOT NULL REFERENCES organizations(id),

  -- Queue classification (immutable)
  queue_type              queue_type NOT NULL,
  entity_type             TEXT NOT NULL,
  entity_id               UUID NOT NULL,

  -- Case linkage
  execution_case_id       UUID,

  -- Lifecycle
  status                  queue_projection_status NOT NULL DEFAULT 'active',

  -- Priority: 0=interrupt, 1=today, 2=week, 3=background
  priority                INTEGER NOT NULL DEFAULT 2,

  -- Ownership
  assignee_user_id        UUID,
  responsible_lawyer_user_id UUID,

  -- Escalation
  escalation_level        INTEGER NOT NULL DEFAULT 0,
  last_escalation_at      TIMESTAMPTZ,

  -- Blocking
  is_blocked              BOOLEAN NOT NULL DEFAULT FALSE,
  blocking_reason         TEXT,

  -- Staleness
  is_stale                BOOLEAN NOT NULL DEFAULT FALSE,

  -- SLA
  sla_deadline_at         TIMESTAMPTZ,
  sla_breached_at         TIMESTAMPTZ,

  -- Snooze / defer
  snooze_until            TIMESTAMPTZ,
  deferred_until          TIMESTAMPTZ,
  snoozed_by_user_id      UUID,

  -- Denormalized display fields
  display_title           TEXT NOT NULL DEFAULT '',
  display_label           TEXT,
  key_date                TIMESTAMPTZ,
  metadata                JSONB,

  -- Causality (immutable)
  source_causing_event_id UUID,

  -- Provenance
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Natural key uniqueness: one active projection per entity per queue
-- Enables idempotent upserts by consumers
CREATE UNIQUE INDEX queue_proj_entity_unique
  ON queue_projections(organization_id, queue_type, entity_type, entity_id);

-- Primary queue query: active items sorted by priority + key_date
CREATE INDEX queue_proj_org_queue_priority_idx
  ON queue_projections(organization_id, queue_type, status, priority, key_date);

-- Assignee view
CREATE INDEX queue_proj_assignee_idx
  ON queue_projections(assignee_user_id, status, priority)
  WHERE assignee_user_id IS NOT NULL;

-- Lawyer accountability view
CREATE INDEX queue_proj_lawyer_idx
  ON queue_projections(responsible_lawyer_user_id, status, priority)
  WHERE responsible_lawyer_user_id IS NOT NULL;

-- SLA sweep: items past SLA deadline not yet breached
CREATE INDEX queue_proj_sla_idx
  ON queue_projections(organization_id, sla_deadline_at, sla_breached_at, status)
  WHERE sla_deadline_at IS NOT NULL AND status != 'resolved';

-- Escalation sweep
CREATE INDEX queue_proj_escalation_idx
  ON queue_projections(organization_id, escalation_level, priority, status)
  WHERE status = 'active';

-- Snooze wake
CREATE INDEX queue_proj_snooze_idx
  ON queue_projections(organization_id, status, snooze_until)
  WHERE status = 'snoozed';

-- Entity lookup
CREATE INDEX queue_proj_entity_idx
  ON queue_projections(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- workflow_tasks
--
-- Operational task assigned to staff members.
-- Mutable: updated through lifecycle transitions.
-- ----------------------------------------------------------------------------

CREATE TABLE workflow_tasks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant isolation
  organization_id             UUID NOT NULL REFERENCES organizations(id),

  -- Task classification (immutable)
  task_type                   workflow_task_type NOT NULL,

  -- Content
  title                       TEXT NOT NULL,
  description                 TEXT,

  -- Lifecycle
  status                      workflow_task_status NOT NULL DEFAULT 'pending',

  -- Priority
  priority                    deadline_priority NOT NULL DEFAULT 'normal',

  -- Case linkage
  execution_case_id           UUID REFERENCES execution_cases(id),

  -- Source entity (immutable)
  source_entity_type          TEXT,
  source_entity_id            UUID,
  causing_event_id            UUID,

  -- Linked deadline (optional mirror)
  linked_deadline_id          UUID,

  -- Claim / assignment
  claimed_by_user_id          UUID REFERENCES users(id),
  claimed_at                  TIMESTAMPTZ,
  assigned_to_user_id         UUID REFERENCES users(id),
  assigned_by_user_id         UUID REFERENCES users(id),
  assigned_at                 TIMESTAMPTZ,

  -- Blocking
  is_blocked                  BOOLEAN NOT NULL DEFAULT FALSE,
  blocking_reason             TEXT,
  blocking_conditions         JSONB,

  -- Review requirement
  requires_review             BOOLEAN NOT NULL DEFAULT FALSE,

  -- SLA
  due_at                      TIMESTAMPTZ,

  -- Completion (terminal)
  completed_at                TIMESTAMPTZ,
  completed_by_user_id        UUID REFERENCES users(id),
  completion_evidence_type    TEXT,
  completion_evidence_id      TEXT,

  -- Cancellation (terminal)
  cancelled_at                TIMESTAMPTZ,
  cancelled_by_user_id        UUID REFERENCES users(id),
  cancellation_reason         TEXT,

  -- Escalation
  escalated_at                TIMESTAMPTZ,
  escalated_to_user_id        UUID REFERENCES users(id),
  escalation_reason           TEXT,

  -- Task hierarchy
  parent_task_id              UUID REFERENCES workflow_tasks(id),

  -- Metadata
  task_metadata               JSONB,

  -- Provenance
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id          UUID REFERENCES users(id),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary task queue: org + status + priority + due
CREATE INDEX workflow_tasks_org_status_idx
  ON workflow_tasks(organization_id, status, priority, due_at);

-- Assignee views
CREATE INDEX workflow_tasks_assignee_idx
  ON workflow_tasks(assigned_to_user_id, status)
  WHERE assigned_to_user_id IS NOT NULL;

CREATE INDEX workflow_tasks_claimed_idx
  ON workflow_tasks(claimed_by_user_id, status)
  WHERE claimed_by_user_id IS NOT NULL;

-- Case view
CREATE INDEX workflow_tasks_case_idx
  ON workflow_tasks(execution_case_id, status)
  WHERE execution_case_id IS NOT NULL;

-- Source entity lookup
CREATE INDEX workflow_tasks_source_idx
  ON workflow_tasks(source_entity_type, source_entity_id)
  WHERE source_entity_type IS NOT NULL;

-- SLA sweep
CREATE INDEX workflow_tasks_due_idx
  ON workflow_tasks(organization_id, due_at, status)
  WHERE due_at IS NOT NULL AND status NOT IN ('completed', 'cancelled');

-- ----------------------------------------------------------------------------
-- queue_assignments (append-only)
--
-- Immutable ownership change history for queue projections and workflow tasks.
-- No UPDATE trigger — this table is never mutated after insert.
-- ----------------------------------------------------------------------------

CREATE TABLE queue_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  target_entity_type  TEXT NOT NULL,
  target_entity_id    UUID NOT NULL,
  assignment_type     TEXT NOT NULL,
  from_user_id        UUID,
  to_user_id          UUID,
  acted_by_user_id    UUID,
  reason              TEXT,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  causing_event_id    UUID,
  correlation_id      UUID NOT NULL,
  metadata            JSONB
);

CREATE INDEX queue_assignments_entity_idx
  ON queue_assignments(target_entity_type, target_entity_id, assigned_at);

CREATE INDEX queue_assignments_user_idx
  ON queue_assignments(organization_id, to_user_id, assigned_at)
  WHERE to_user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- queue_escalations (append-only)
--
-- Immutable escalation event history.
-- No UPDATE trigger — this table is never mutated after insert.
-- ----------------------------------------------------------------------------

CREATE TABLE queue_escalations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  target_entity_type  TEXT NOT NULL,
  target_entity_id    UUID NOT NULL,
  trigger             escalation_trigger NOT NULL,
  previous_level      INTEGER NOT NULL,
  new_level           INTEGER NOT NULL,
  notified_users      JSONB,
  escalation_reason   TEXT,
  breached_at         TIMESTAMPTZ,
  sla_breach          JSONB,
  actor_type          TEXT NOT NULL DEFAULT 'system',
  actor_id            TEXT NOT NULL,
  escalated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  causing_event_id    UUID,
  correlation_id      UUID NOT NULL
);

CREATE INDEX queue_escalations_entity_idx
  ON queue_escalations(target_entity_type, target_entity_id, escalated_at);

CREATE INDEX queue_escalations_org_idx
  ON queue_escalations(organization_id, escalated_at);

CREATE INDEX queue_escalations_trigger_idx
  ON queue_escalations(organization_id, trigger, escalated_at);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- Only for mutable tables: queue_projections, workflow_tasks
-- Append-only tables (queue_assignments, queue_escalations) never get triggers.
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER queue_projections_updated_at
  BEFORE UPDATE ON queue_projections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER workflow_tasks_updated_at
  BEFORE UPDATE ON workflow_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
