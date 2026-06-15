-- =============================================================================
-- 0011 — Snapshot promotion pipeline (document → snapshot → engine)
-- =============================================================================

CREATE TYPE snapshot_promotion_status AS ENUM (
  'requested',
  'proposed',
  'confirmed',
  'skipped',
  'failed'
);

CREATE TABLE snapshot_promotions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id),
  source_document_id    UUID NOT NULL REFERENCES documents(id),
  extraction_run_id     UUID NOT NULL REFERENCES extraction_runs(id),
  execution_case_id     UUID NOT NULL REFERENCES execution_cases(id),
  snapshot_kind         TEXT NOT NULL,
  snapshot_id           UUID,
  status                snapshot_promotion_status NOT NULL DEFAULT 'requested',
  extraction_type       TEXT NOT NULL,
  promoted_by_user_id   UUID REFERENCES users(id),
  promoted_at           TIMESTAMPTZ,
  trigger_event_id      UUID,
  correlation_id        UUID,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT snapshot_promotions_extraction_run_unique UNIQUE (extraction_run_id)
);

COMMENT ON TABLE snapshot_promotions IS
  'Audit trail linking confirmed document extractions to proposed/confirmed snapshots.';

CREATE UNIQUE INDEX snapshot_promotions_trigger_idempotency_idx
  ON snapshot_promotions (source_document_id, trigger_event_id)
  WHERE trigger_event_id IS NOT NULL;

CREATE INDEX snapshot_promotions_status_idx
  ON snapshot_promotions (organization_id, status);
