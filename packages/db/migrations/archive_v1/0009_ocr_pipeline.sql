-- =============================================================================
-- 0009 — OCR pipeline foundation (runs + append-only results)
-- =============================================================================

CREATE TYPE ocr_run_status AS ENUM (
  'requested',
  'running',
  'completed',
  'failed'
);

CREATE TABLE ocr_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  document_id       UUID NOT NULL REFERENCES documents(id),
  run_number        INTEGER NOT NULL,
  status            ocr_run_status NOT NULL DEFAULT 'requested',
  provider_id       TEXT NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  error_message     TEXT,
  trigger_event_id  UUID,
  correlation_id    UUID,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ocr_runs_document_run_number_unique UNIQUE (document_id, run_number)
);

COMMENT ON TABLE ocr_runs IS
  'OCR job lifecycle — one row per OCR attempt chain. Re-OCR creates run_number+1.';

CREATE UNIQUE INDEX ocr_runs_trigger_idempotency_idx
  ON ocr_runs (document_id, trigger_event_id)
  WHERE trigger_event_id IS NOT NULL;

CREATE INDEX ocr_runs_status_queue_idx
  ON ocr_runs (organization_id, status)
  WHERE status IN ('requested', 'running');

CREATE TABLE document_ocr_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  document_id       UUID NOT NULL REFERENCES documents(id),
  ocr_run_id        UUID NOT NULL REFERENCES ocr_runs(id),
  provider_id       TEXT NOT NULL,
  raw_text          TEXT NOT NULL,
  page_count        INTEGER NOT NULL DEFAULT 1,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_at      TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_ocr_results_run_unique UNIQUE (ocr_run_id)
);

COMMENT ON TABLE document_ocr_results IS
  'Append-only OCR text output. Immutable after insert — re-OCR creates a new run + result row.';

CREATE INDEX document_ocr_results_document_idx
  ON document_ocr_results (document_id, extracted_at DESC);
