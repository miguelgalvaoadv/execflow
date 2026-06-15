-- =============================================================================
-- 0010 — Extraction pipeline foundation (runs + append-only structured results)
-- =============================================================================

CREATE TYPE extraction_run_status AS ENUM (
  'requested',
  'running',
  'review',
  'confirmed',
  'failed'
);

CREATE TABLE extraction_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  document_id       UUID NOT NULL REFERENCES documents(id),
  ocr_run_id        UUID NOT NULL REFERENCES ocr_runs(id),
  ocr_result_id     UUID NOT NULL REFERENCES document_ocr_results(id),
  run_number        INTEGER NOT NULL,
  status            extraction_run_status NOT NULL DEFAULT 'requested',
  extraction_type   TEXT NOT NULL DEFAULT 'generic',
  provider_id       TEXT NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  error_message     TEXT,
  trigger_event_id  UUID,
  correlation_id    UUID,
  confirmed_at      TIMESTAMPTZ,
  confirmed_by_user_id UUID REFERENCES users(id),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT extraction_runs_document_run_number_unique UNIQUE (document_id, run_number)
);

COMMENT ON TABLE extraction_runs IS
  'Structured extraction lifecycle — OCR text → proposed fields → human confirmation.';

CREATE UNIQUE INDEX extraction_runs_trigger_idempotency_idx
  ON extraction_runs (document_id, trigger_event_id)
  WHERE trigger_event_id IS NOT NULL;

CREATE INDEX extraction_runs_status_queue_idx
  ON extraction_runs (organization_id, status)
  WHERE status IN ('requested', 'running', 'review');

CREATE TABLE document_extraction_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  document_id       UUID NOT NULL REFERENCES documents(id),
  extraction_run_id UUID NOT NULL REFERENCES extraction_runs(id),
  extraction_type   TEXT NOT NULL,
  structured_data   JSONB NOT NULL,
  confidence        confidence_level NOT NULL DEFAULT 'medium',
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_at      TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_extraction_results_run_unique UNIQUE (extraction_run_id)
);

COMMENT ON TABLE document_extraction_results IS
  'Append-only structured extraction output. Immutable after insert — re-extraction creates a new run + result row.';

CREATE INDEX document_extraction_results_document_idx
  ON document_extraction_results (document_id, extracted_at DESC);
