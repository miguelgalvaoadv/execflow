-- =============================================================================
-- 0012 — Human review & confirmation layer (audit + rejection states)
-- =============================================================================

ALTER TYPE extraction_run_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE snapshot_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE queue_type ADD VALUE IF NOT EXISTS 'snapshot_review';

CREATE TYPE review_subject_type AS ENUM ('extraction', 'snapshot');
CREATE TYPE review_decision AS ENUM ('approved', 'rejected');

CREATE TABLE review_decisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  subject_type        review_subject_type NOT NULL,
  subject_id          UUID NOT NULL,
  document_id         UUID REFERENCES documents(id),
  snapshot_kind       TEXT,
  reviewer_user_id    UUID NOT NULL REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ NOT NULL,
  decision            review_decision NOT NULL,
  reason              TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE review_decisions IS
  'Append-only human review decisions for extractions and snapshots.';

CREATE INDEX review_decisions_subject_idx
  ON review_decisions (organization_id, subject_type, subject_id);

CREATE INDEX review_decisions_reviewer_idx
  ON review_decisions (organization_id, reviewer_user_id, reviewed_at DESC);

ALTER TABLE execution_custody_snapshots
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by_user_id UUID REFERENCES users(id);
