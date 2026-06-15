-- =============================================================================
-- Migration 0006: Legal Computation Engine Foundation (Phase 7)
-- =============================================================================
-- Creates the database layer for:
-- - Playbook governance (families, versions, org configs, case contexts)
-- - Engine run records (append-only computation history)
-- - Rule execution traces (append-only per-rule provenance)
-- - Explanation bundles (structured legal explanations)
-- - Snapshot dependencies (input dependency graph for stale detection)
-- - Recalculation runs (cascading recalculation propagation tracking)
--
-- Architecture ref: execution-engine.md, playbook-system.md
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Engine and playbook enum types
-- ---------------------------------------------------------------------------

CREATE TYPE "playbook_status" AS ENUM (
  'draft',
  'review',
  'published',
  'retired'
);

CREATE TYPE "strategy_profile" AS ENUM (
  'conservative',
  'standard',
  'aggressive'
);

CREATE TYPE "engine_run_status" AS ENUM (
  'running',
  'completed',
  'failed',
  'superseded'
);

CREATE TYPE "engine_run_trigger" AS ENUM (
  'manual',
  'timeline_event',
  'snapshot_superseded',
  'custody_snapshot',
  'document_associated',
  'playbook_published',
  'recalculation',
  'scheduled'
);

CREATE TYPE "rule_outcome" AS ENUM (
  'opportunity_suggested',
  'opportunity_blocked',
  'insufficient_data',
  'warning',
  'snapshot_proposal',
  'no_match'
);

CREATE TYPE "uncertainty_level" AS ENUM (
  'none',
  'low',
  'medium',
  'high',
  'blocking'
);

CREATE TYPE "snapshot_dependency_type" AS ENUM (
  'sentence_snapshot',
  'custody_snapshot',
  'timeline_event',
  'document',
  'playbook_version'
);

CREATE TYPE "recalculation_run_status" AS ENUM (
  'scheduled',
  'running',
  'completed',
  'failed',
  'skipped'
);

-- ---------------------------------------------------------------------------
-- playbook_families — top-level playbook identity
-- ---------------------------------------------------------------------------

CREATE TABLE "playbook_families" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"     UUID REFERENCES "organizations"("id"),
  "slug"                TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "jurisdiction_scope"  TEXT NOT NULL,
  "is_overlay"          BOOLEAN NOT NULL DEFAULT false,
  "description"         TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "playbook_families_slug_org_uniq" UNIQUE ("slug", "organization_id")
);

CREATE INDEX "playbook_families_org_idx"
  ON "playbook_families"("organization_id");

CREATE INDEX "playbook_families_jurisdiction_idx"
  ON "playbook_families"("jurisdiction_scope");

-- ---------------------------------------------------------------------------
-- playbook_versions — immutable published rule snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE "playbook_versions" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "family_id"             UUID NOT NULL REFERENCES "playbook_families"("id"),
  "organization_id"       UUID REFERENCES "organizations"("id"),
  "version_label"         TEXT NOT NULL,
  "status"                playbook_status NOT NULL DEFAULT 'draft',
  "effective_from"        TIMESTAMPTZ NOT NULL,
  "effective_to"          TIMESTAMPTZ,
  "supersedes_version_id" UUID REFERENCES "playbook_versions"("id"),
  "rule_groups"           JSONB NOT NULL DEFAULT '{}',
  "content_hash"          TEXT,
  "legal_references"      JSONB NOT NULL DEFAULT '[]',
  "published_by_user_id"  UUID REFERENCES "users"("id"),
  "published_at"          TIMESTAMPTZ,
  "created_by_user_id"    UUID REFERENCES "users"("id"),
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "playbook_versions_family_label_uniq" UNIQUE ("family_id", "version_label")
);

CREATE INDEX "playbook_versions_family_status_idx"
  ON "playbook_versions"("family_id", "status");

CREATE INDEX "playbook_versions_org_status_idx"
  ON "playbook_versions"("organization_id", "status");

-- Engine selection: resolve version at instant T
CREATE INDEX "playbook_versions_effective_idx"
  ON "playbook_versions"("family_id", "effective_from", "effective_to");

-- ---------------------------------------------------------------------------
-- org_playbook_configs — org-wide interpretation settings
-- ---------------------------------------------------------------------------

CREATE TABLE "org_playbook_configs" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"         UUID NOT NULL REFERENCES "organizations"("id"),
  "family_id"               UUID NOT NULL REFERENCES "playbook_families"("id"),
  "strategy_profile"        strategy_profile NOT NULL DEFAULT 'standard',
  "default_branches"        JSONB NOT NULL DEFAULT '{}',
  "notes"                   TEXT,
  "last_updated_by_user_id" UUID REFERENCES "users"("id"),
  "created_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "org_playbook_configs_org_family_uniq" UNIQUE ("organization_id", "family_id")
);

CREATE INDEX "org_playbook_configs_org_idx"
  ON "org_playbook_configs"("organization_id");

-- ---------------------------------------------------------------------------
-- case_playbook_contexts — per-case branch overrides (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE "case_playbook_contexts" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"          UUID NOT NULL REFERENCES "organizations"("id"),
  "execution_case_id"        UUID NOT NULL REFERENCES "execution_cases"("id"),
  "branch_overrides"         JSONB NOT NULL DEFAULT '{}',
  "strategy_profile"         strategy_profile,
  "reason"                   TEXT NOT NULL,
  "set_by_user_id"           UUID NOT NULL REFERENCES "users"("id"),
  "valid_until"              TIMESTAMPTZ,
  "superseded_at"            TIMESTAMPTZ,
  "superseded_by_context_id" UUID REFERENCES "case_playbook_contexts"("id"),
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "case_playbook_contexts_case_idx"
  ON "case_playbook_contexts"("execution_case_id", "created_at");

CREATE INDEX "case_playbook_contexts_org_idx"
  ON "case_playbook_contexts"("organization_id");

-- ---------------------------------------------------------------------------
-- engine_runs — append-only evaluation history
-- ---------------------------------------------------------------------------

CREATE TABLE "engine_runs" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"      UUID NOT NULL REFERENCES "organizations"("id"),
  "execution_case_id"    UUID NOT NULL REFERENCES "execution_cases"("id"),
  "playbook_version_id"  UUID NOT NULL REFERENCES "playbook_versions"("id"),
  "overlay_version_id"   UUID REFERENCES "playbook_versions"("id"),
  "case_context_id"      UUID,
  "strategy_profile"     strategy_profile NOT NULL DEFAULT 'standard',
  "evaluated_at"         TIMESTAMPTZ NOT NULL,
  "started_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at"         TIMESTAMPTZ,
  "status"               engine_run_status NOT NULL DEFAULT 'running',
  "trigger"              engine_run_trigger NOT NULL,
  "trigger_entity_type"  TEXT,
  "trigger_entity_id"    UUID,
  "requested_by_user_id" UUID REFERENCES "users"("id"),
  "uncertainty_level"    uncertainty_level NOT NULL DEFAULT 'none',
  "blocking_codes"       JSONB NOT NULL DEFAULT '[]',
  "missing_data_summary" JSONB NOT NULL DEFAULT '[]',
  "opportunities_created" JSONB NOT NULL DEFAULT '[]',
  "warnings_emitted"     JSONB NOT NULL DEFAULT '[]',
  "error_details"        TEXT,
  "is_replay"            BOOLEAN NOT NULL DEFAULT FALSE,
  "superseded_by_run_id" UUID,
  "correlation_id"       UUID,
  "causation_id"         UUID,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "engine_runs_case_idx"
  ON "engine_runs"("execution_case_id", "evaluated_at");

CREATE INDEX "engine_runs_org_status_idx"
  ON "engine_runs"("organization_id", "status");

CREATE INDEX "engine_runs_playbook_idx"
  ON "engine_runs"("playbook_version_id");

CREATE INDEX "engine_runs_correlation_idx"
  ON "engine_runs"("correlation_id");

-- ---------------------------------------------------------------------------
-- engine_rule_traces — append-only per-rule execution records
-- ---------------------------------------------------------------------------

CREATE TABLE "engine_rule_traces" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"   UUID NOT NULL REFERENCES "organizations"("id"),
  "engine_run_id"     UUID NOT NULL REFERENCES "engine_runs"("id"),
  "rule_id"           TEXT NOT NULL,
  "playbook_version_id" UUID NOT NULL,
  "rule_group_id"     TEXT,
  "branch_id"         TEXT,
  "evaluator_id"      TEXT NOT NULL,
  "evaluation_order"  INTEGER NOT NULL,
  "inputs_hash"       TEXT NOT NULL,
  "outputs_hash"      TEXT NOT NULL,
  "inputs_snapshot"   JSONB,
  "outputs_snapshot"  JSONB,
  "outcome"           rule_outcome NOT NULL,
  "uncertainty_level" uncertainty_level NOT NULL DEFAULT 'none',
  "blocking_codes"    JSONB NOT NULL DEFAULT '[]',
  "uncertainty_factors" JSONB NOT NULL DEFAULT '[]',
  "missing_data_refs" JSONB NOT NULL DEFAULT '[]',
  "started_at"        TIMESTAMPTZ NOT NULL,
  "completed_at"      TIMESTAMPTZ NOT NULL,
  "duration_ms"       INTEGER,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "engine_rule_traces_run_order_idx"
  ON "engine_rule_traces"("engine_run_id", "evaluation_order");

CREATE INDEX "engine_rule_traces_rule_idx"
  ON "engine_rule_traces"("rule_id", "playbook_version_id");

CREATE INDEX "engine_rule_traces_org_idx"
  ON "engine_rule_traces"("organization_id");

-- ---------------------------------------------------------------------------
-- explanation_bundles — structured legal explanations (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE "explanation_bundles" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"     UUID NOT NULL REFERENCES "organizations"("id"),
  "engine_run_id"       UUID NOT NULL REFERENCES "engine_runs"("id"),
  "target_entity_type"  TEXT NOT NULL,
  "target_entity_id"    UUID NOT NULL,
  "conclusion_type"     TEXT NOT NULL,
  "payload"             JSONB NOT NULL,
  "playbook_version_id" UUID NOT NULL,
  "rule_ids_applied"    JSONB NOT NULL DEFAULT '[]',
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "explanation_bundles_entity_idx"
  ON "explanation_bundles"("target_entity_type", "target_entity_id");

CREATE INDEX "explanation_bundles_run_idx"
  ON "explanation_bundles"("engine_run_id");

CREATE INDEX "explanation_bundles_org_idx"
  ON "explanation_bundles"("organization_id");

-- ---------------------------------------------------------------------------
-- snapshot_dependencies — input dependency graph (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE "snapshot_dependencies" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"          UUID NOT NULL REFERENCES "organizations"("id"),
  "engine_run_id"            UUID NOT NULL REFERENCES "engine_runs"("id"),
  "dependency_type"          snapshot_dependency_type NOT NULL,
  "dependency_entity_id"     UUID NOT NULL,
  "dependency_effective_at"  TIMESTAMPTZ,
  "dependency_version"       TEXT,
  "is_stale"                 BOOLEAN NOT NULL DEFAULT false,
  "staled_at"                TIMESTAMPTZ,
  "stale_reason"             TEXT,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "snapshot_dependencies_run_idx"
  ON "snapshot_dependencies"("engine_run_id");

CREATE INDEX "snapshot_dependencies_entity_idx"
  ON "snapshot_dependencies"("dependency_type", "dependency_entity_id");

CREATE INDEX "snapshot_dependencies_stale_idx"
  ON "snapshot_dependencies"("organization_id", "is_stale");

-- ---------------------------------------------------------------------------
-- recalculation_runs — cascading recalculation tracking (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE "recalculation_runs" (
  "id"                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"            UUID NOT NULL REFERENCES "organizations"("id"),
  "execution_case_id"          UUID NOT NULL REFERENCES "execution_cases"("id"),
  "trigger_entity_type"        TEXT NOT NULL,
  "trigger_entity_id"          UUID NOT NULL,
  "trigger_reason"             TEXT NOT NULL,
  "parent_recalculation_run_id" UUID,
  "chain_depth"                INTEGER NOT NULL DEFAULT 0,
  "status"                     recalculation_run_status NOT NULL DEFAULT 'scheduled',
  "produced_engine_run_id"     UUID REFERENCES "engine_runs"("id"),
  "superseded_engine_run_ids"  JSONB NOT NULL DEFAULT '[]',
  "material_change_detected"   JSONB NOT NULL DEFAULT 'false',
  "change_summary"             JSONB,
  "scheduled_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "started_at"                 TIMESTAMPTZ,
  "completed_at"               TIMESTAMPTZ,
  "error_details"              TEXT,
  "correlation_id"             UUID,
  "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "recalculation_runs_case_idx"
  ON "recalculation_runs"("execution_case_id", "scheduled_at");

CREATE INDEX "recalculation_runs_org_status_idx"
  ON "recalculation_runs"("organization_id", "status");

CREATE INDEX "recalculation_runs_trigger_idx"
  ON "recalculation_runs"("trigger_entity_type", "trigger_entity_id");

CREATE INDEX "recalculation_runs_parent_idx"
  ON "recalculation_runs"("parent_recalculation_run_id");
