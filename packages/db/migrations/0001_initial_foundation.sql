-- =============================================================================
-- EXECFLOW — Migration 0001: Initial Foundation
-- =============================================================================
-- Phase: 1 — Data layer (IMPLEMENTATION_ORDER.md §1.1)
-- Creates: Organization, User, Membership, AuditLog, DomainEvent
--
-- REVIEW REQUIREMENTS (mandatory before applying):
-- 1. All enum values match _enums.ts exactly.
-- 2. All column names match the Drizzle schema files exactly (snake_case).
-- 3. Indexes cover every query pattern documented in schema files.
-- 4. No ON DELETE CASCADE on append-only tables (audit_logs, domain_events).
-- 5. No DEFAULT CURRENT_TIMESTAMP on immutable columns — only on mutable ones.
--
-- APPLY: pnpm --filter @execflow/db db:migrate
-- ROLLBACK: This migration has NO rollback. Forward-only per ENGINEERING_PRINCIPLES.md.
-- =============================================================================

-- =============================================================================
-- STEP 1: PostgreSQL extensions
-- =============================================================================

-- gen_random_uuid() for UUID primary keys.
-- Available in PostgreSQL 13+ without extension. Kept explicit for clarity.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- STEP 2: Enum types
-- =============================================================================
-- Enums are created before tables that reference them.
-- Enum values must exactly match _enums.ts definitions.
-- To add a value later: ALTER TYPE enum_name ADD VALUE 'new_value';
-- To remove a value: create a new enum type and migrate — no safe in-place removal.
-- =============================================================================

CREATE TYPE organization_status AS ENUM (
  'active',
  'suspended',
  'deactivated'
);

CREATE TYPE user_status AS ENUM (
  'active',
  'invited',
  'suspended',
  'deactivated'
);

CREATE TYPE membership_status AS ENUM (
  'active',
  'invited',
  'suspended'
);

CREATE TYPE membership_role AS ENUM (
  'admin',
  'lawyer',
  'assistant'
);

CREATE TYPE actor_type AS ENUM (
  'user',
  'agent_ingestion',
  'agent_analysis',
  'agent_drafting',
  'agent_notification',
  'system',
  'admin_impersonating'
);

CREATE TYPE event_processing_status AS ENUM (
  'pending',
  'published',
  'failed',
  'dead_lettered'
);

-- =============================================================================
-- STEP 3: Core entity tables (dependency order)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations
-- The top-level tenant boundary. All other business entities reference this.
-- Architecture ref: ARCHITECTURE_RULES.md §M-01, §M-02.
-- Immutable fields: id, slug, created_at.
-- No hard-delete path — deactivate via status + deactivated_at.
-- -----------------------------------------------------------------------------
CREATE TABLE organizations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  status            organization_status NOT NULL DEFAULT 'active',
  timezone          TEXT        NOT NULL DEFAULT 'America/Sao_Paulo',
  settings          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at    TIMESTAMPTZ

  -- Constraints
  , CONSTRAINT organizations_slug_length CHECK (
      char_length(slug) BETWEEN 3 AND 48
    )
  , CONSTRAINT organizations_slug_format CHECK (
      slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$'
    )
);

CREATE UNIQUE INDEX organizations_slug_unique ON organizations (slug);

COMMENT ON TABLE organizations IS
  'Top-level multi-tenant boundary. All business entities scope to one organization. '
  'No hard-delete — deactivate via status=deactivated.';

COMMENT ON COLUMN organizations.slug IS
  'Immutable after creation. URL-safe unique identifier. 3-48 chars, lowercase alphanumeric + hyphens.';

COMMENT ON COLUMN organizations.settings IS
  'Operational configuration (overload_threshold, quiet_hours, etc.). '
  'NEVER store legal rule parameters here — those belong in playbook_versions.';

COMMENT ON COLUMN organizations.timezone IS
  'IANA timezone for deadline display and digest timing. All stored timestamps remain UTC.';

-- -----------------------------------------------------------------------------
-- users
-- Platform-level human identity. Linked to organizations via memberships.
-- Architecture ref: data-model-v1.md §2.1, ENGINEERING_PRINCIPLES.md §5.
-- Immutable fields: id, created_at.
-- No hard-delete — users with attribution history are deactivated, never deleted.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT        NOT NULL,
  display_name      TEXT        NOT NULL,
  status            user_status NOT NULL DEFAULT 'invited',
  bar_number        TEXT,
  phone             TEXT,
  avatar_url        TEXT,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX users_email_unique ON users (email);

COMMENT ON TABLE users IS
  'Authenticated human actor. Platform-level (not org-scoped). '
  'No hard-delete — users with AuditLog attribution are deactivated only. '
  'LGPD: email and phone are PII; access is logged.';

COMMENT ON COLUMN users.bar_number IS
  'OAB registration number. Required for lawyer role holders to approve pieces '
  'and confirm legal conclusions. Validated at service layer.';

COMMENT ON COLUMN users.status IS
  'Lifecycle: invited → active → suspended | deactivated. '
  'Deactivated users cannot approve pieces, dismiss critical deadlines, or confirm snapshots.';

-- -----------------------------------------------------------------------------
-- memberships
-- Join table: User ↔ Organization with role.
-- Architecture ref: data-model-v1.md §1 (Membership), ARCHITECTURE_RULES.md §M-01.
-- Immutable fields: id, organization_id, user_id, created_at.
-- MVP: one active membership per (user_id, organization_id) pair.
-- -----------------------------------------------------------------------------
CREATE TABLE memberships (
  id                  UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID              NOT NULL REFERENCES organizations (id),
  user_id             UUID              NOT NULL REFERENCES users (id),
  role                membership_role   NOT NULL,
  status              membership_status NOT NULL DEFAULT 'invited',
  invited_by_user_id  UUID              REFERENCES users (id),
  invited_at          TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  suspended_at        TIMESTAMPTZ,
  suspension_reason   TEXT,
  created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- One active membership per (user, org) pair.
-- The unique constraint covers all statuses to prevent re-invitation creating duplicates.
CREATE UNIQUE INDEX memberships_org_user_unique ON memberships (organization_id, user_id);

-- Fast lookup: "what organizations is this user a member of?"
CREATE INDEX memberships_user_idx ON memberships (user_id, status);

-- Fast lookup: "who are the members of this organization?"
CREATE INDEX memberships_org_idx ON memberships (organization_id, status, role);

COMMENT ON TABLE memberships IS
  'Authorization boundary binding a user to an organization with a role. '
  'MVP: one (user, organization) pair. Role changes are audited. '
  'Suspended memberships are retained for attribution history.';

COMMENT ON COLUMN memberships.role IS
  'Permission hierarchy: admin > lawyer > assistant. '
  'Agents (agent.ingestion, agent.analysis) are NOT membership roles — '
  'they are actor types in AuditLog, not human org members.';

-- =============================================================================
-- STEP 4: Append-only infrastructure tables
-- =============================================================================
-- These tables have NO update or delete path from application code.
-- The constraints below enforce this at the database level where possible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_logs
-- Immutable, append-only record of every action in the system.
-- Architecture ref: event-state-architecture.md §8, ENGINEERING_PRINCIPLES.md §5.
--
-- IMMUTABILITY: No ON DELETE CASCADE references this table's id.
-- No application code issues UPDATE or DELETE against this table.
-- The Drizzle client wrapper exposes only insert().
--
-- RETENTION: Operational table retains N months (configurable).
-- Older records archived to R2 as JSONL — never hard-deleted.
-- Architecture ref: technical-stack-decision.md §3.5 (audit storage).
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        REFERENCES organizations (id),
  actor_type            actor_type  NOT NULL,
  actor_id              TEXT        NOT NULL,
  actor_role            TEXT,
  impersonating_user_id UUID,
  model_id              TEXT,
  action                TEXT        NOT NULL,
  entity_type           TEXT        NOT NULL,
  entity_id             TEXT        NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changes               JSONB,
  metadata              JSONB,
  ip_address            TEXT,
  session_id            TEXT,
  request_id            TEXT

  -- No updated_at — append-only.
  -- No deleted_at — no soft-delete on audit records.
  -- No FK on entity_id — polymorphic; entity may be in any table.
);

-- Primary compliance export pattern: all actions in org X during time range Y
CREATE INDEX audit_logs_org_occurred_idx
  ON audit_logs (organization_id, occurred_at);

-- Primary entity history pattern: all actions on entity X
CREATE INDEX audit_logs_entity_idx
  ON audit_logs (entity_type, entity_id);

-- Actor attribution pattern: all actions by actor X in org Y
CREATE INDEX audit_logs_actor_idx
  ON audit_logs (actor_type, actor_id, organization_id);

COMMENT ON TABLE audit_logs IS
  'Immutable append-only record of every system action. '
  'NEVER UPDATE or DELETE from this table. '
  'AuditLog writes are co-committed with their subject action (same transaction). '
  'Architecture ref: event-state-architecture.md §8, ENGINEERING_PRINCIPLES.md §5.';

COMMENT ON COLUMN audit_logs.actor_id IS
  'Interpretation depends on actor_type: '
  '''user'' → users.id UUID; '
  '''agent_*'' → agent instance identifier; '
  '''system'' → worker name / job id. '
  'Stored as TEXT (not UUID FK) to accommodate non-user actors.';

COMMENT ON COLUMN audit_logs.changes IS
  'Before/after diff or entity snapshot. Schema varies by entity_type + action. '
  'Architecture ref: event-state-architecture.md §8.5.';

COMMENT ON COLUMN audit_logs.metadata IS
  'Provenance chain: trigger_event_id, engine_run_id, playbook_version_id, request_id. '
  'Architecture ref: event-state-architecture.md §8.4.';

-- -----------------------------------------------------------------------------
-- domain_events
-- Transactional outbox + persistent event log.
-- Architecture ref: event-state-architecture.md §2 (event system model),
--                   technical-stack-decision.md §4.1 (transactional outbox).
--
-- WRITE RULE: Written in the same transaction as the originating state change.
-- RELAY RULE: Only the outbox-relay worker updates processing_status, published_at,
--             failed_at, retry_count, last_error_message, locked_until.
-- RETENTION: Events are retained permanently (after archival to R2 for old records).
--            Replayable events are never deleted.
-- -----------------------------------------------------------------------------
CREATE TABLE domain_events (
  id                  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          TEXT                    NOT NULL,
  aggregate_type      TEXT                    NOT NULL,
  aggregate_id        UUID                    NOT NULL,
  causation_id        UUID,
  correlation_id      UUID                    NOT NULL,
  organization_id     UUID                    REFERENCES organizations (id),
  actor_type          TEXT                    NOT NULL,
  actor_id            TEXT                    NOT NULL,
  occurred_at         TIMESTAMPTZ             NOT NULL,
  recorded_at         TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  payload             JSONB                   NOT NULL,
  metadata            JSONB,
  replayable          BOOLEAN                 NOT NULL DEFAULT TRUE,
  processing_status   event_processing_status NOT NULL DEFAULT 'pending',
  published_at        TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  retry_count         INTEGER                 NOT NULL DEFAULT 0,
  last_error_message  TEXT,
  locked_until        TIMESTAMPTZ

  -- Constraints
  , CONSTRAINT domain_events_retry_count_positive CHECK (retry_count >= 0)
  , CONSTRAINT domain_events_occurred_recorded_order CHECK (
      -- occurred_at may be in the past (retroactive events) but not in the future
      occurred_at <= NOW() + INTERVAL '5 minutes'
    )
);

-- Outbox relay query: pending events not locked, ordered by recorded_at
-- Worker uses: WHERE processing_status = 'pending'
--   AND (locked_until IS NULL OR locked_until < NOW())
--   FOR UPDATE SKIP LOCKED
CREATE INDEX domain_events_outbox_idx
  ON domain_events (processing_status, recorded_at)
  WHERE processing_status IN ('pending', 'failed');

-- Replay query: all replayable events for aggregate X before date Y
CREATE INDEX domain_events_aggregate_idx
  ON domain_events (aggregate_type, aggregate_id, occurred_at);

-- Org event stream query: all events in org X in time range Y
CREATE INDEX domain_events_org_occurred_idx
  ON domain_events (organization_id, occurred_at);

-- Causality chain traversal: all events directly caused by event X
CREATE INDEX domain_events_causation_idx
  ON domain_events (causation_id)
  WHERE causation_id IS NOT NULL;

-- Correlation chain traversal: all events in operation X
CREATE INDEX domain_events_correlation_idx
  ON domain_events (correlation_id);

COMMENT ON TABLE domain_events IS
  'Transactional outbox + persistent event log. Dual purpose: '
  '(1) Outbox: events written here in same transaction as state change, '
  'picked up by relay worker for async distribution. '
  '(2) Event log: published events retained permanently for replay and analytics. '
  'Architecture ref: event-state-architecture.md §2, technical-stack-decision.md §4.1.';

COMMENT ON COLUMN domain_events.occurred_at IS
  'Legal time: when the domain event happened in the real world. '
  'May be in the past for retroactive events (e.g., confirming a 2021 court decision in 2025). '
  'The engine uses this for temporal calculations. NEVER conflate with recorded_at.';

COMMENT ON COLUMN domain_events.recorded_at IS
  'System time: when this record was written. Always the current UTC clock. '
  'Used for outbox relay ordering and SLA calculations. '
  'Architecture ref: event-state-architecture.md §10.4.';

COMMENT ON COLUMN domain_events.replayable IS
  'FALSE for side-effect events (notification dispatches, digest sends) that should '
  'NOT be re-fired during replay scenarios. TRUE for domain state events (default).';

COMMENT ON COLUMN domain_events.locked_until IS
  'Set by the relay worker when picking up a row to prevent concurrent processing. '
  'Uses SELECT ... FOR UPDATE SKIP LOCKED pattern. Cleared after successful publication.';

-- =============================================================================
-- STEP 5: updated_at trigger function
-- =============================================================================
-- Automatically updates the updated_at column on mutable tables.
-- Applied ONLY to tables with an updated_at column:
--   organizations, users, memberships.
-- NOT applied to append-only tables (audit_logs, domain_events).
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- END OF MIGRATION 0001
-- =============================================================================
-- Next migration: 0002_auth_sessions.sql — Better Auth session tables
-- (Phase 2 — Authentication and organization bootstrap)
-- Architecture ref: IMPLEMENTATION_ORDER.md §2.1.
-- =============================================================================
