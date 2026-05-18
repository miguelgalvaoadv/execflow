-- ============================================================================
-- Migration 0004: Deadline and Opportunity entities
-- Phase 5: Deadline and opportunity operational foundation
--
-- Creates:
--   ENUMS:  deadline_status, deadline_class, deadline_origin, deadline_priority,
--           opportunity_type, opportunity_status, opportunity_review_action
--
--   TABLES: deadlines
--           deadline_history          (append-only)
--           opportunities
--           opportunity_reviews       (append-only)
--           opportunity_status_history (append-only)
--
-- DESIGN NOTES:
-- - deadline_history, opportunity_reviews, opportunity_status_history are
--   append-only tables: no updated_at, no deleted_at, no UPDATE triggers.
-- - All mutable tables (deadlines, opportunities) get updated_at triggers.
-- - Indexes are named for their query pattern (not just columns) per Phase 3 convention.
-- ============================================================================

BEGIN;

-- ============================================================================
-- ENUMS
-- ============================================================================

-- deadline_status: lifecycle states for a Deadline
-- Terminal states: completed, dismissed
CREATE TYPE deadline_status AS ENUM (
    'open',
    'acknowledged',
    'overdue',
    'completed',
    'dismissed'
);

-- deadline_class: thematic category driving notification and escalation rules
CREATE TYPE deadline_class AS ENUM (
    'legal',
    'benefit',
    'disciplinary',
    'calculation',
    'internal',
    'recurring',
    'sla'
);

-- deadline_origin: how the deadline was created (immutable)
CREATE TYPE deadline_origin AS ENUM (
    'manual',
    'extracted',
    'rule',
    'recurring'
);

-- deadline_priority: criticality and notification frequency
CREATE TYPE deadline_priority AS ENUM (
    'critical',
    'high',
    'normal',
    'low'
);

-- opportunity_type: the specific procedural advantage (immutable after creation)
CREATE TYPE opportunity_type AS ENUM (
    'progression',
    'remission',
    'detraction',
    'amnesty',
    'commutation',
    'hc',
    'pad_challenge',
    'prescription',
    'recalculation',
    'excess_execution',
    'rights_violation',
    'manual'
);

-- opportunity_status: lifecycle states
-- Terminal states: realized, dismissed, expired
CREATE TYPE opportunity_status AS ENUM (
    'suggested',
    'qualified',
    'pursuing',
    'realized',
    'dismissed',
    'expired'
);

-- opportunity_review_action: the specific action taken in a review
CREATE TYPE opportunity_review_action AS ENUM (
    'qualified',
    'rejected',
    'changes_requested',
    'deferred',
    'escalated',
    'pursuing_started',
    'realized'
);

-- ============================================================================
-- TABLE: deadlines
-- ============================================================================

CREATE TABLE deadlines (
    -- Identity
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant isolation (immutable)
    organization_id             UUID NOT NULL REFERENCES organizations(id),

    -- Case linkage (immutable)
    execution_case_id           UUID NOT NULL REFERENCES execution_cases(id),

    -- Core fields
    title                       TEXT NOT NULL,
    description                 TEXT,

    -- Legal/operational due date (legal time — TWO-CLOCK principle)
    due_at                      TIMESTAMPTZ NOT NULL,

    -- Classification (origin is immutable)
    deadline_class              deadline_class NOT NULL,
    origin                      deadline_origin NOT NULL,
    priority                    deadline_priority NOT NULL DEFAULT 'normal',

    -- Lifecycle
    status                      deadline_status NOT NULL DEFAULT 'open',

    -- Assignment
    assignee_user_id            UUID REFERENCES users(id),

    -- Source references (immutable provenance)
    source_event_id             UUID,
    source_document_id          UUID,
    playbook_version_id         UUID,
    legal_basis                 TEXT,

    -- Recurring chain
    parent_deadline_id          UUID REFERENCES deadlines(id),
    recurrence_pattern          JSONB,

    -- Escalation tracking
    escalation_level            INTEGER NOT NULL DEFAULT 0,
    escalated_at                TIMESTAMPTZ,

    -- Acknowledgement
    acknowledged_at             TIMESTAMPTZ,
    acknowledged_by_user_id     UUID REFERENCES users(id),

    -- Completion evidence
    completed_at                TIMESTAMPTZ,
    completed_by_user_id        UUID REFERENCES users(id),
    completion_evidence_type    TEXT,
    completion_evidence_id      TEXT,

    -- Dismissal
    dismissed_at                TIMESTAMPTZ,
    dismissed_by_user_id        UUID REFERENCES users(id),
    dismissed_reason            TEXT,
    dismissed_reason_code       TEXT,

    -- Queue compatibility flags
    blocking_reason             TEXT,
    is_blocked                  BOOLEAN NOT NULL DEFAULT false,
    is_stale                    BOOLEAN NOT NULL DEFAULT false,
    last_checked_at             TIMESTAMPTZ,

    -- Provenance (created_by_user_id is immutable)
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id          UUID NOT NULL REFERENCES users(id),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE deadlines IS
    'Time-bound obligations for execution cases. Legal, benefit, operational, and SLA deadlines. '
    'origin field is immutable after creation. due_at changes are recorded in deadline_history.';
COMMENT ON COLUMN deadlines.origin IS 'Immutable — how the deadline was created. Never update this field.';
COMMENT ON COLUMN deadlines.due_at IS 'Legal/operational due date (legal time). Changes recorded in deadline_history.';
COMMENT ON COLUMN deadlines.is_blocked IS 'Queue engine flag: true when a blocking condition prevents action.';
COMMENT ON COLUMN deadlines.is_stale IS 'Queue engine flag: true when underlying data is outdated and needs re-evaluation.';
COMMENT ON COLUMN deadlines.escalation_level IS '0=none, 1=assignee notified, 2=lawyer notified, 3=admin notified.';

-- Indexes: deadlines
CREATE INDEX deadlines_org_status_due_idx    ON deadlines(organization_id, status, due_at);
CREATE INDEX deadlines_case_idx              ON deadlines(execution_case_id, status, due_at);
CREATE INDEX deadlines_assignee_idx          ON deadlines(assignee_user_id, status);
CREATE INDEX deadlines_escalation_idx        ON deadlines(organization_id, escalation_level, status);
CREATE INDEX deadlines_blocked_idx           ON deadlines(organization_id, is_blocked);
CREATE INDEX deadlines_priority_idx          ON deadlines(organization_id, priority, status);

-- updated_at trigger: deadlines (mutable table)
CREATE TRIGGER deadlines_updated_at
    BEFORE UPDATE ON deadlines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TABLE: deadline_history  (APPEND-ONLY)
-- ============================================================================

CREATE TABLE deadline_history (
    -- Identity
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant isolation
    organization_id     UUID NOT NULL REFERENCES organizations(id),

    -- Deadline reference
    deadline_id         UUID NOT NULL REFERENCES deadlines(id),

    -- Change description
    change_type         TEXT NOT NULL,
    previous_value      JSONB,
    new_value           JSONB,
    reason              TEXT,

    -- Attribution
    changed_by_user_id  UUID NOT NULL REFERENCES users(id),

    -- System time of change (DB default — never set by application)
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Causality
    causing_event_id    UUID,
    correlation_id      UUID NOT NULL
);

COMMENT ON TABLE deadline_history IS
    'Append-only changelog for deadline mutations. '
    'No updated_at, no deleted_at. No UPDATE or DELETE ever executed on this table.';

CREATE INDEX deadline_history_deadline_idx ON deadline_history(deadline_id, changed_at);
CREATE INDEX deadline_history_org_idx      ON deadline_history(organization_id, changed_at);

-- ============================================================================
-- TABLE: opportunities
-- ============================================================================

CREATE TABLE opportunities (
    -- Identity
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant isolation (immutable)
    organization_id         UUID NOT NULL REFERENCES organizations(id),

    -- Case linkage (immutable)
    execution_case_id       UUID NOT NULL REFERENCES execution_cases(id),

    -- Type (immutable after creation)
    opportunity_type        opportunity_type NOT NULL,

    -- Lifecycle
    status                  opportunity_status NOT NULL DEFAULT 'suggested',

    -- Detection / qualification timing (detected_at is immutable)
    detected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    qualified_at            TIMESTAMPTZ,
    qualified_by_user_id    UUID REFERENCES users(id),

    -- Opportunity window
    window_start_at         TIMESTAMPTZ,
    window_end_at           TIMESTAMPTZ,

    -- Content
    summary                 TEXT NOT NULL,
    rationale               TEXT,

    -- Confidence (engine-assigned; null for manual)
    confidence_level        confidence_level,
    uncertainty_flags       JSONB,

    -- Blocking and missing data
    blocking_conditions     JSONB,
    required_documents      JSONB,
    missing_data_fields     JSONB,

    -- Source references (immutable provenance)
    sentence_snapshot_id    UUID,
    source_analysis_id      UUID,
    source_event_id         UUID,
    playbook_version_id     UUID,
    legal_basis             TEXT,

    -- Outcome references
    realized_piece_draft_id UUID,

    -- Terminal state timestamps
    dismissed_at            TIMESTAMPTZ,
    dismissed_by_user_id    UUID REFERENCES users(id),
    dismissed_reason        TEXT,
    expired_at              TIMESTAMPTZ,

    -- Queue compatibility flags
    requires_review         BOOLEAN NOT NULL DEFAULT true,
    is_pending_review       BOOLEAN NOT NULL DEFAULT false,
    is_blocked              BOOLEAN NOT NULL DEFAULT false,
    is_stale                BOOLEAN NOT NULL DEFAULT false,

    -- Provenance (created_by_user_id null for engine-generated)
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id      UUID REFERENCES users(id),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE opportunities IS
    'Procedural advantage hypotheses. Requires human qualification before action. '
    'opportunity_type and detected_at are immutable. Status transitions via opportunity_reviews.';
COMMENT ON COLUMN opportunities.opportunity_type IS 'Immutable after creation.';
COMMENT ON COLUMN opportunities.detected_at IS 'Immutable — system time of first detection.';
COMMENT ON COLUMN opportunities.confidence_level IS 'Engine-assigned confidence. Null for manual opportunities.';
COMMENT ON COLUMN opportunities.requires_review IS 'Queue engine: true = lawyer must actively review before action.';
COMMENT ON COLUMN opportunities.is_pending_review IS 'Queue engine: true = awaiting specific review action.';
COMMENT ON COLUMN opportunities.is_stale IS 'Queue engine: true when source data changed and re-evaluation is needed.';

-- Indexes: opportunities
CREATE INDEX opportunities_org_status_idx       ON opportunities(organization_id, status, detected_at);
CREATE INDEX opportunities_case_idx             ON opportunities(execution_case_id, status);
CREATE INDEX opportunities_type_status_idx      ON opportunities(organization_id, opportunity_type, status);
CREATE INDEX opportunities_pending_review_idx   ON opportunities(organization_id, is_pending_review, status);
CREATE INDEX opportunities_window_idx           ON opportunities(organization_id, window_end_at, status);
CREATE INDEX opportunities_blocked_idx          ON opportunities(organization_id, is_blocked);

-- updated_at trigger: opportunities (mutable table)
CREATE TRIGGER opportunities_updated_at
    BEFORE UPDATE ON opportunities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TABLE: opportunity_reviews  (APPEND-ONLY)
-- ============================================================================

CREATE TABLE opportunity_reviews (
    -- Identity
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant isolation
    organization_id                 UUID NOT NULL REFERENCES organizations(id),

    -- Opportunity reference
    opportunity_id                  UUID NOT NULL REFERENCES opportunities(id),

    -- Review action
    review_action                   opportunity_review_action NOT NULL,

    -- Attribution
    reviewer_user_id                UUID NOT NULL REFERENCES users(id),

    -- System time of review (DB default — never set by application)
    reviewed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Mandatory explanation (non-negotiable — enforced by service layer)
    explanation                     TEXT NOT NULL,

    -- Rejection specifics
    rejection_reason_code           TEXT,

    -- Deferral specifics
    deferred_until                  TIMESTAMPTZ,

    -- Escalation specifics
    escalated_to_user_id            UUID REFERENCES users(id),

    -- State snapshot at review time
    opportunity_status_at_review    opportunity_status NOT NULL,
    confidence_level_at_review      confidence_level,
    data_snapshot_ref               JSONB,

    -- Causality
    correlation_id                  UUID NOT NULL
);

COMMENT ON TABLE opportunity_reviews IS
    'Append-only record of human review decisions on opportunities. '
    'explanation is mandatory for all actions. No UPDATE or DELETE ever executed.';
COMMENT ON COLUMN opportunity_reviews.explanation IS 'Mandatory. Service layer rejects empty explanations.';
COMMENT ON COLUMN opportunity_reviews.opportunity_status_at_review IS
    'Snapshot of opportunity status when review was recorded — for replay integrity.';

CREATE INDEX opportunity_reviews_opp_idx        ON opportunity_reviews(opportunity_id, reviewed_at);
CREATE INDEX opportunity_reviews_reviewer_idx   ON opportunity_reviews(organization_id, reviewer_user_id, reviewed_at);
CREATE INDEX opportunity_reviews_action_idx     ON opportunity_reviews(organization_id, review_action, reviewed_at);

-- ============================================================================
-- TABLE: opportunity_status_history  (APPEND-ONLY)
-- ============================================================================

CREATE TABLE opportunity_status_history (
    -- Identity
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant isolation
    organization_id         UUID NOT NULL REFERENCES organizations(id),

    -- Opportunity reference
    opportunity_id          UUID NOT NULL REFERENCES opportunities(id),

    -- Transition record
    previous_status         opportunity_status NOT NULL,
    new_status              opportunity_status NOT NULL,

    -- Attribution
    changed_by_actor_type   TEXT NOT NULL,
    changed_by_actor_id     TEXT NOT NULL,

    -- System time (DB default — never set by application)
    changed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Context
    reason                  TEXT,
    review_id               UUID,
    causing_event_id        UUID,
    correlation_id          UUID NOT NULL,
    metadata                JSONB
);

COMMENT ON TABLE opportunity_status_history IS
    'Append-only record of every opportunity status transition. '
    'Used for replay and legal auditability. No UPDATE or DELETE ever executed.';

CREATE INDEX opp_status_history_opp_idx         ON opportunity_status_history(opportunity_id, changed_at);
CREATE INDEX opp_status_history_org_idx         ON opportunity_status_history(organization_id, changed_at);
CREATE INDEX opp_status_history_new_status_idx  ON opportunity_status_history(organization_id, new_status, changed_at);

COMMIT;
