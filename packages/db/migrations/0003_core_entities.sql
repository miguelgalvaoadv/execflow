-- =============================================================================
-- Migration: 0003_core_entities
-- Phase: 3 — Core Legal Domain Entities
-- Description: Creates enum types, tables, and indexes for the foundational
--              legal domain entities of EXECFLOW's execução penal practice.
--
-- Tables created (in dependency order):
--   1. enum types (14 new domain enums)
--   2. prison_units
--   3. clients
--   4. execution_cases
--   5. execution_custody_snapshots (append-only)
--   6. intake_bundles
--   7. documents
--   8. timeline_events (append-only)
--   9. sentence_snapshots (append-only)
--
-- Indexes:
--   - Process number lookup (unique partial)
--   - Organization isolation (all tables)
--   - Timeline ordering (occurred_at, effective_at)
--   - Replay reconstruction (dual-clock compound indexes)
--   - OCR processing queues (ocr_status)
--   - Queue-first navigation patterns
--
-- Architecture constraints applied:
--   - Append-only tables: NO updated_at, NO deleted_at triggers
--   - Two-clock principle: occurred_at/effective_at ≠ recorded_at
--   - Immutable fields: documented in column comments
--   - All tables isolated by organization_id
--
-- Architecture ref: ARCHITECTURE_RULES.md, ENGINEERING_PRINCIPLES.md §2,
--                   data-model-v1.md §2-3, execution-engine.md §0.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUM TYPES
-- Order: independent enums with no inter-dependencies.
-- Note: PostgreSQL enum types are database-global objects.
-- Naming: snake_case, no 'execflow_' prefix (isolated to this DB).
-- -----------------------------------------------------------------------------

-- Client lifecycle
CREATE TYPE client_status AS ENUM (
  'active',
  'inactive',
  'merged',
  'archived'
);

-- ExecutionCase lifecycle
CREATE TYPE case_status AS ENUM (
  'intake',
  'active',
  'suspended',
  'closed',
  'archived'
);

-- ExecutionCase type classification
CREATE TYPE case_kind AS ENUM (
  'primary',
  'apenso',
  'incident',
  'parallel'
);

-- Penal execution regime (Brazilian LEP categories + operational variants)
CREATE TYPE regime_type AS ENUM (
  'fechado',
  'semiaberto',
  'aberto',
  'albergue',
  'domiciliar',
  'provisorio',
  'unknown'
);

-- SentenceSnapshot review lifecycle
CREATE TYPE snapshot_status AS ENUM (
  'proposed',
  'confirmed',
  'superseded'
);

-- Confidence level for calculations and extractions
CREATE TYPE confidence_level AS ENUM (
  'high',
  'medium',
  'low',
  'unknown'
);

-- IntakeBundle processing lifecycle
CREATE TYPE intake_bundle_status AS ENUM (
  'received',
  'extraction_pending',
  'extraction_review',
  'association_review',
  'execution_active',
  'failed_ocr',
  'rejected'
);

-- Intake source channel (how files entered the system)
CREATE TYPE intake_source_channel AS ENUM (
  'intake_manual',
  'intake_pdf',
  'intake_scan',
  'intake_whatsapp',
  'intake_email',
  'intake_api',
  'intake_tribunal'
);

-- Document lifecycle
CREATE TYPE document_status AS ENUM (
  'pending_association',
  'pending_extraction',
  'extraction_running',
  'extraction_review',
  'confirmed',
  'archived',
  'superseded'
);

-- OCR/extraction pipeline status (independent of document lifecycle)
CREATE TYPE ocr_status AS ENUM (
  'not_applicable',
  'pending',
  'running',
  'completed',
  'failed',
  'skipped'
);

-- Document legal sensitivity classification (LGPD + privilege)
CREATE TYPE sensitivity_level AS ENUM (
  'public',
  'standard',
  'sensitive',
  'restricted'
);

-- Timeline event broad category
CREATE TYPE timeline_event_category AS ENUM (
  'court',
  'prison',
  'sentence',
  'benefit',
  'legal_action',
  'document',
  'ai',
  'internal',
  'system'
);

-- Timeline event origin
CREATE TYPE timeline_event_source AS ENUM (
  'manual',
  'document',
  'integration',
  'ai_suggestion',
  'system_rule'
);

-- Timeline event visibility
CREATE TYPE timeline_visibility AS ENUM (
  'legal',
  'internal',
  'both'
);

-- =============================================================================
-- TABLE: prison_units
-- Reference catalog of prison establishments.
-- May be system-global (organization_id IS NULL) or org-specific.
-- Architecture ref: data-model-v1.md §2.4
-- =============================================================================

CREATE TABLE prison_units (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid(),
  organization_id         UUID        REFERENCES organizations(id),    -- NULL = global record

  -- Core identification
  name                    TEXT        NOT NULL,
  code                    TEXT        NOT NULL,

  -- Geographic classification
  state_code              TEXT,                                        -- BR UF code: 'SP', 'RJ', etc.
  city                    TEXT,

  -- Capability metadata
  -- JSON array of regime_type values: ["fechado", "semiaberto"]
  regime_capabilities     JSONB       NOT NULL DEFAULT '[]',

  -- Extended metadata
  administrative_authority TEXT,                                       -- e.g., "SAP-SP", "DEPEN"
  cnpj                    TEXT,

  -- Status
  active                  BOOLEAN     NOT NULL DEFAULT TRUE,           -- FALSE = decommissioned; retain for history

  -- Timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT prison_units_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE prison_units IS
  'Reference catalog of prison establishments. organization_id=NULL means system-global. '
  'active=FALSE means decommissioned; records retained for custody history.';

COMMENT ON COLUMN prison_units.code IS
  'Official or internal code. Unique per (code, organization_id) scope.';

COMMENT ON COLUMN prison_units.regime_capabilities IS
  'JSON array of regime_type enum values this facility can house. '
  'NOT authoritative for legal decisions — playbook governs that.';

-- Unique code within scope (global or org-specific)
CREATE UNIQUE INDEX prison_units_code_org_unique
  ON prison_units (code, organization_id);

-- Browse by state + active
CREATE INDEX prison_units_state_idx
  ON prison_units (state_code, active);

-- Org-scoped lookup
CREATE INDEX prison_units_org_idx
  ON prison_units (organization_id, active);

-- updated_at trigger
CREATE TRIGGER set_prison_units_updated_at
  BEFORE UPDATE ON prison_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: clients
-- Natural person under penal execution representation.
-- LGPD: cpf, rg, birth_date, contact_channels are sensitive personal data.
-- Architecture ref: data-model-v1.md §2.1
-- =============================================================================

CREATE TABLE clients (
  id                          UUID            NOT NULL DEFAULT gen_random_uuid(),
  organization_id             UUID            NOT NULL REFERENCES organizations(id),

  -- Legal identity (LGPD-sensitive fields: restrict reads, log access)
  full_name                   TEXT            NOT NULL,
  cpf                         TEXT,                                    -- SENSITIVE: CPF (Cadastro de Pessoa Física)
  rg                          TEXT,                                    -- SENSITIVE: RG (Registro Geral)
  birth_date                  DATE,                                    -- SENSITIVE

  -- Operational identity
  display_name                TEXT,                                    -- Preferred/social name
  aliases                     JSONB           NOT NULL DEFAULT '[]',  -- Array of strings: apelidos, former names
  internal_ref                TEXT,                                    -- Firm reference (required when CPF unknown)

  -- Professional attribution
  responsible_lawyer_user_id  UUID            NOT NULL REFERENCES users(id),

  -- Contact (LGPD-sensitive)
  contact_channels            JSONB,                                   -- SENSITIVE: [{ type, value, notes }]

  -- Notes
  notes                       TEXT,

  -- Lifecycle
  status                      client_status   NOT NULL DEFAULT 'active',

  -- Merge tracking
  merged_into_client_id       UUID            REFERENCES clients(id), -- Set when status='merged'

  -- Timestamps
  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(), -- Immutable
  created_by_user_id          UUID            NOT NULL REFERENCES users(id), -- Immutable
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ,                            -- Soft-delete; binary data retained

  CONSTRAINT clients_pkey PRIMARY KEY (id),

  -- CPF uniqueness within org (when present)
  -- Partial: NULLs do not violate; allows multiple clients without CPF
  CONSTRAINT clients_org_cpf_unique UNIQUE NULLS NOT DISTINCT (organization_id, cpf)
);

COMMENT ON TABLE clients IS
  'Natural person under penal execution representation. '
  'cpf, rg, birth_date, contact_channels are LGPD-sensitive. '
  'NEVER hard-delete clients with ExecutionCase, Document, or VisitNote history.';

COMMENT ON COLUMN clients.cpf IS
  'LGPD SENSITIVE. CPF uniqueness enforced per organization. '
  'NULL allowed (pre-documentation intakes). Duplicate triggers merge workflow.';

COMMENT ON COLUMN clients.aliases IS
  'JSON array of strings: apelidos, social names, former names. '
  'Used for search disambiguation and duplicate detection.';

COMMENT ON COLUMN clients.internal_ref IS
  'Firm-internal reference. Required when cpf is NULL.';

COMMENT ON COLUMN clients.status IS
  'Lifecycle: active ↔ inactive; active→merged; any→archived. '
  'NEVER delete clients with legal history.';

-- Filtered listing by status (queue-first navigation)
CREATE INDEX clients_org_status_idx
  ON clients (organization_id, status);

-- All clients for a lawyer (workload view)
CREATE INDEX clients_lawyer_idx
  ON clients (organization_id, responsible_lawyer_user_id);

-- Internal reference lookup
CREATE INDEX clients_internal_ref_idx
  ON clients (organization_id, internal_ref)
  WHERE internal_ref IS NOT NULL;

-- updated_at trigger
CREATE TRIGGER set_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: execution_cases
-- The operational container for one execução penal matter.
-- Architecture ref: data-model-v1.md §2.3, execution-workflows.md §2
-- =============================================================================

CREATE TABLE execution_cases (
  id                            UUID          NOT NULL DEFAULT gen_random_uuid(),
  organization_id               UUID          NOT NULL REFERENCES organizations(id),
  client_id                     UUID          NOT NULL REFERENCES clients(id),

  -- Process identification
  internal_ref                  TEXT          NOT NULL,               -- Firm reference (required)
  execution_process_number      TEXT,                                 -- CNJ process number (may be NULL at intake)
  origin_process_number         TEXT,                                 -- Conviction process number

  -- Court / jurisdiction
  court_name                    TEXT,                                 -- e.g., "1ª VEP de São Paulo"
  court_jurisdiction            TEXT,                                 -- "Comarca/UF"

  -- Case structure
  case_kind                     case_kind     NOT NULL DEFAULT 'primary',
  parent_execution_case_id      UUID          REFERENCES execution_cases(id), -- For apenso/incident

  -- Operational state
  case_status                   case_status   NOT NULL DEFAULT 'intake',
  responsible_lawyer_user_id    UUID          NOT NULL REFERENCES users(id),

  -- Non-authoritative sentence summary (NOT used by engine; SentenceSnapshot is authoritative)
  sentence_summary              TEXT,

  -- Temporal (TWO-CLOCK PRINCIPLE: opened_at = legal time, created_at = system time)
  opened_at                     TIMESTAMPTZ   NOT NULL,               -- Legal/operational open date
  closed_at                     TIMESTAMPTZ,
  closed_reason                 TEXT,
  process_number_pending_since  TIMESTAMPTZ,                         -- For SLA: case without process# > X days

  -- Timestamps
  created_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW(), -- Immutable
  created_by_user_id            UUID          NOT NULL REFERENCES users(id), -- Immutable
  updated_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ,                          -- Strongly discouraged if filings exist

  CONSTRAINT execution_cases_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE execution_cases IS
  'Operational container for one execução penal matter. '
  'execution_process_number is unique per org when not null (partial unique index). '
  'sentence_summary is NON-AUTHORITATIVE; see sentence_snapshots for arithmetic.';

COMMENT ON COLUMN execution_cases.execution_process_number IS
  'CNJ-format process number. NULL at intake. Unique per org when present.';

COMMENT ON COLUMN execution_cases.opened_at IS
  'TWO-CLOCK: LEGAL TIME — when case was legally opened. '
  'May predate created_at significantly. Engine uses this for calculations.';

COMMENT ON COLUMN execution_cases.case_status IS
  'Lifecycle: intake→active→suspended|closed→archived. All transitions logged.';

-- Process number uniqueness within org (partial — NULL values excluded)
CREATE UNIQUE INDEX execution_cases_process_number_unique
  ON execution_cases (organization_id, execution_process_number)
  WHERE execution_process_number IS NOT NULL;

-- Internal reference uniqueness within org
CREATE UNIQUE INDEX execution_cases_internal_ref_unique
  ON execution_cases (organization_id, internal_ref);

-- Primary queue: cases by status (org-level case management)
CREATE INDEX execution_cases_org_status_idx
  ON execution_cases (organization_id, case_status);

-- Cases by client
CREATE INDEX execution_cases_client_idx
  ON execution_cases (organization_id, client_id);

-- Cases by responsible lawyer + status (workload view)
CREATE INDEX execution_cases_lawyer_idx
  ON execution_cases (organization_id, responsible_lawyer_user_id, case_status);

-- updated_at trigger
CREATE TRIGGER set_execution_cases_updated_at
  BEFORE UPDATE ON execution_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: execution_custody_snapshots  (APPEND-ONLY)
-- History of custody regime and location changes for an execution case.
--
-- APPEND-ONLY: NO UPDATE, NO DELETE, NO updated_at, NO deleted_at.
-- Two-clock: effective_at = LEGAL TIME, recorded_at = SYSTEM TIME.
-- Architecture ref: data-model-v1.md §3.1
-- =============================================================================

CREATE TABLE execution_custody_snapshots (
  id                          UUID            NOT NULL DEFAULT gen_random_uuid(),
  organization_id             UUID            NOT NULL REFERENCES organizations(id),
  execution_case_id           UUID            NOT NULL REFERENCES execution_cases(id),

  -- Custody state
  regime                      regime_type     NOT NULL,
  prison_unit_id              UUID            REFERENCES prison_units(id), -- NULL for aberto/domiciliar

  -- TWO-CLOCK: do NOT conflate these
  effective_at                TIMESTAMPTZ     NOT NULL,              -- LEGAL TIME: when regime became effective
  recorded_at                 TIMESTAMPTZ     NOT NULL DEFAULT NOW(),-- SYSTEM TIME: ingestion timestamp (immutable)

  -- Confidence
  confidence                  confidence_level NOT NULL DEFAULT 'medium',

  -- Attribution / provenance
  source_event_id             UUID,                                  -- Logical FK to timeline_events (not hard FK)
  notes                       TEXT,

  -- Confirmation gate (engine reads only confirmed rows)
  confirmed_by_user_id        UUID            REFERENCES users(id),  -- NULL = unconfirmed
  confirmed_at                TIMESTAMPTZ,

  -- Amendment chain (corrections = new row, old row superseded)
  superseded_at               TIMESTAMPTZ,                          -- When this snapshot was superseded
  superseded_by_snapshot_id   UUID            REFERENCES execution_custody_snapshots(id),
  amends_snapshot_id          UUID            REFERENCES execution_custody_snapshots(id),

  CONSTRAINT custody_snapshots_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE execution_custody_snapshots IS
  'APPEND-ONLY: NO UPDATE OR DELETE EVER. '
  'History of custody regime/location changes. '
  'effective_at = LEGAL TIME (when regime was effective). '
  'recorded_at = SYSTEM TIME (ingestion; immutable). '
  'Engine uses: WHERE confirmed AND effective_at <= NOW() ORDER BY effective_at DESC LIMIT 1.';

COMMENT ON COLUMN execution_custody_snapshots.effective_at IS
  'LEGAL TIME: when regime/unit became legally effective. '
  'Use for all legal calculations. NEVER use recorded_at for arithmetic.';

COMMENT ON COLUMN execution_custody_snapshots.recorded_at IS
  'SYSTEM TIME: database ingestion timestamp. Immutable. '
  'Used for audit, SLA monitoring, and replay reconstruction only.';

COMMENT ON COLUMN execution_custody_snapshots.confirmed_by_user_id IS
  'NULL = proposed/unconfirmed. Only confirmed snapshots are engine inputs. '
  'ARCHITECTURE_RULES.md §D-03.';

-- Primary query: current and historical custody (both forward and reverse)
CREATE INDEX custody_snapshots_case_effective_idx
  ON execution_custody_snapshots (execution_case_id, effective_at DESC);

-- Confirmation review queue: unconfirmed snapshots
CREATE INDEX custody_snapshots_unconfirmed_idx
  ON execution_custody_snapshots (organization_id, confirmed_by_user_id)
  WHERE confirmed_by_user_id IS NULL;

-- Org-level audit stream
CREATE INDEX custody_snapshots_org_idx
  ON execution_custody_snapshots (organization_id, recorded_at);

-- =============================================================================
-- TABLE: intake_bundles
-- Logical grouping of files received in one intake event.
-- Architecture ref: data-model-v1.md §3.5, execution-workflows.md §1
-- =============================================================================

CREATE TABLE intake_bundles (
  id                          UUID                  NOT NULL DEFAULT gen_random_uuid(),
  organization_id             UUID                  NOT NULL REFERENCES organizations(id),

  -- Source and receipt (immutable)
  source_channel              intake_source_channel NOT NULL,
  received_at                 TIMESTAMPTZ           NOT NULL,         -- Operational receipt time (immutable)
  uploader_user_id            UUID                  NOT NULL REFERENCES users(id),

  -- Processing state
  status                      intake_bundle_status  NOT NULL DEFAULT 'received',

  -- Association proposals (AI/OCR suggested — NOT human-confirmed)
  proposed_client_id          UUID                  REFERENCES clients(id),
  proposed_execution_case_id  UUID                  REFERENCES execution_cases(id),

  -- Human-confirmed associations
  associated_client_id        UUID                  REFERENCES clients(id),
  associated_execution_case_id UUID                 REFERENCES execution_cases(id),
  associated_at               TIMESTAMPTZ,
  associated_by_user_id       UUID                  REFERENCES users(id),

  -- File tracking
  file_count                  INTEGER               NOT NULL DEFAULT 0,

  -- Missing data (recovery workflow)
  -- JSON: [{ field: string, reason: string, required: boolean }]
  missing_fields              JSONB,

  -- Notes
  notes                       TEXT,

  -- Timestamps
  created_at                  TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  CONSTRAINT intake_bundles_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE intake_bundles IS
  'Logical grouping of files from one intake event. '
  'proposed_* fields are AI/OCR suggestions — NOT authoritative. '
  'associated_* fields are human-confirmed. '
  'Documents reference this via intake_bundle_id.';

COMMENT ON COLUMN intake_bundles.proposed_client_id IS
  'AI/OCR suggested client. NOT authoritative. Requires human confirmation. '
  'ARCHITECTURE_RULES.md §D-03.';

COMMENT ON COLUMN intake_bundles.missing_fields IS
  'JSON list of required fields not yet extracted or confirmed. '
  'Drives the recovery workflow: "complete these fields to proceed."';

-- Intake review queue (primary operational index)
CREATE INDEX intake_bundles_org_status_idx
  ON intake_bundles (organization_id, status);

-- Bundles by uploader (workload view)
CREATE INDEX intake_bundles_uploader_idx
  ON intake_bundles (organization_id, uploader_user_id);

-- Bundles by confirmed client
CREATE INDEX intake_bundles_client_idx
  ON intake_bundles (associated_client_id)
  WHERE associated_client_id IS NOT NULL;

-- Bundles by confirmed case
CREATE INDEX intake_bundles_case_idx
  ON intake_bundles (associated_execution_case_id)
  WHERE associated_execution_case_id IS NOT NULL;

-- SLA monitoring: oldest unprocessed bundles
CREATE INDEX intake_bundles_received_idx
  ON intake_bundles (organization_id, received_at)
  WHERE status NOT IN ('execution_active', 'rejected');

-- updated_at trigger
CREATE TRIGGER set_intake_bundles_updated_at
  BEFORE UPDATE ON intake_bundles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: documents
-- Immutable stored file + lifecycle metadata.
-- storage_key, checksum_sha256, mime_type, file_name, byte_size, uploaded_at
-- are IMMUTABLE after creation.
-- Architecture ref: data-model-v1.md §2.6
-- =============================================================================

CREATE TABLE documents (
  id                      UUID                  NOT NULL DEFAULT gen_random_uuid(),
  organization_id         UUID                  NOT NULL REFERENCES organizations(id),

  -- Associations (mutable — set during intake review)
  client_id               UUID                  REFERENCES clients(id),
  execution_case_id       UUID                  REFERENCES execution_cases(id),
  intake_bundle_id        UUID                  REFERENCES intake_bundles(id),

  -- Classification (mutable — refined during review)
  document_class          TEXT,                                       -- Free text: 'sentenca', 'despacho', etc.

  -- Storage (IMMUTABLE after creation — blob content never overwritten)
  storage_key             TEXT                  NOT NULL,             -- Blob storage object key (immutable)
  checksum_sha256         TEXT                  NOT NULL,             -- File SHA-256 hex (immutable)
  mime_type               TEXT                  NOT NULL,             -- MIME type (immutable)
  file_name               TEXT                  NOT NULL,             -- Original filename (immutable)
  byte_size               BIGINT                NOT NULL,             -- File size in bytes (immutable)

  -- Lifecycle
  status                  document_status       NOT NULL DEFAULT 'pending_association',
  source_channel          intake_source_channel NOT NULL,

  -- OCR / extraction state (independent of lifecycle)
  ocr_status              ocr_status            NOT NULL DEFAULT 'pending',

  -- Sensitivity classification
  sensitivity_level       sensitivity_level     NOT NULL DEFAULT 'standard',

  -- Version chain (NEW document supersedes old — never overwrite old)
  supersedes_document_id  UUID                  REFERENCES documents(id),

  -- Informal provenance
  whatsapp_forwarded_from TEXT,                                       -- LGPD-sensitive

  -- Confirmation
  confirmed_at            TIMESTAMPTZ,
  confirmed_by_user_id    UUID                  REFERENCES users(id),

  -- Timestamps
  uploaded_at             TIMESTAMPTZ           NOT NULL,             -- File arrival time (immutable)
  uploaded_by_user_id     UUID                  NOT NULL REFERENCES users(id),
  created_at              TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,                                -- Metadata soft-delete; blob NEVER deleted

  CONSTRAINT documents_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE documents IS
  'Immutable stored file + lifecycle metadata. '
  'storage_key, checksum_sha256, mime_type, file_name, byte_size, uploaded_at are IMMUTABLE. '
  'Blob content in storage is NEVER deleted, even after metadata soft-delete. '
  '"Replacement" = new document row with supersedes_document_id pointing to old.';

COMMENT ON COLUMN documents.storage_key IS
  'IMMUTABLE. Blob storage object key (e.g., Cloudflare R2). '
  'Format: {org_id}/{year}/{month}/{uuid}.{ext}. NEVER reused.';

COMMENT ON COLUMN documents.checksum_sha256 IS
  'IMMUTABLE. SHA-256 hex checksum computed at upload. Tamper evidence + duplicate detection.';

COMMENT ON COLUMN documents.ocr_status IS
  'Independent from document status. A confirmed doc may still have pending OCR.';

COMMENT ON COLUMN documents.sensitivity_level IS
  'Access control classification. restricted = lawyer/admin only. All reads logged.';

-- OCR PROCESSING QUEUE: documents needing extraction
CREATE INDEX documents_ocr_queue_idx
  ON documents (organization_id, ocr_status)
  WHERE ocr_status IN ('pending', 'running') AND deleted_at IS NULL;

-- Documents by case + status (primary operational lookup)
CREATE INDEX documents_case_status_idx
  ON documents (execution_case_id, status)
  WHERE execution_case_id IS NOT NULL;

-- Documents by bundle
CREATE INDEX documents_bundle_idx
  ON documents (intake_bundle_id)
  WHERE intake_bundle_id IS NOT NULL;

-- Duplicate detection: same file content across any case/org
CREATE INDEX documents_checksum_idx
  ON documents (checksum_sha256);

-- Documents by client
CREATE INDEX documents_client_idx
  ON documents (organization_id, client_id)
  WHERE client_id IS NOT NULL;

-- Org-level document queue
CREATE INDEX documents_org_status_idx
  ON documents (organization_id, status);

-- updated_at trigger
CREATE TRIGGER set_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: timeline_events  (APPEND-ONLY)
-- Immutable record of facts in a case's legal history.
--
-- APPEND-ONLY: NO UPDATE, NO DELETE, NO updated_at, NO deleted_at.
-- Two-clock: occurred_at = LEGAL TIME, recorded_at = SYSTEM TIME.
-- Corrections: new row with amends_event_id pointing to corrected row.
-- Architecture ref: data-model-v1.md §2.5, event-state-architecture.md §3
-- =============================================================================

CREATE TABLE timeline_events (
  id                  UUID                      NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID                      NOT NULL REFERENCES organizations(id),
  execution_case_id   UUID                      NOT NULL REFERENCES execution_cases(id),

  -- Event classification
  event_type          TEXT                      NOT NULL,             -- Dot-namespaced: 'court.hearing', etc.
  event_category      timeline_event_category   NOT NULL,

  -- TWO-CLOCK: NEVER conflate these
  occurred_at         TIMESTAMPTZ               NOT NULL,             -- LEGAL TIME: when event actually happened
  recorded_at         TIMESTAMPTZ               NOT NULL DEFAULT NOW(), -- SYSTEM TIME: DB ingestion (immutable)

  -- Content
  summary             TEXT                      NOT NULL,
  payload             JSONB                     NOT NULL DEFAULT '{}', -- Event-type–specific structured data

  -- Source and provenance
  source              timeline_event_source     NOT NULL,
  source_ref_type     TEXT,                                           -- Polymorphic: 'Document', 'IntakeBundle', etc.
  source_ref_id       UUID,                                           -- UUID of the source artifact

  -- Actor attribution (two-layer: human + system actor)
  author_user_id      UUID                      REFERENCES users(id), -- NULL for automated events
  actor_type          TEXT                      NOT NULL DEFAULT 'user', -- 'user'|'system'|'agent'
  actor_id            TEXT                      NOT NULL,             -- Mirrors AuditLog.actor_id semantics

  -- Visibility control
  visibility          timeline_visibility       NOT NULL DEFAULT 'both',

  -- AI attribution (populated when source = 'ai_suggestion')
  ai_confidence       NUMERIC(5,4),                                   -- 0.0000–1.0000; NULL when not AI-sourced
  ai_model_id         TEXT,                                           -- AI model identifier

  -- Amendment chain (corrections = new rows, not in-place edits)
  amends_event_id     UUID                      REFERENCES timeline_events(id),

  CONSTRAINT timeline_events_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE timeline_events IS
  'APPEND-ONLY: NO UPDATE OR DELETE EVER. No updated_at. No deleted_at. '
  'Corrections = new row with amends_event_id pointing to incorrect row. '
  'occurred_at = LEGAL TIME (when event happened in real world). '
  'recorded_at = SYSTEM TIME (ingestion timestamp; immutable). '
  'AI-sourced events require human promotion before engine consumption.';

COMMENT ON COLUMN timeline_events.occurred_at IS
  'LEGAL TIME: when this event occurred in the real world. '
  'May be months in the past (retroactive entry). '
  'Engine uses this for ALL legal calculations. NEVER use recorded_at for arithmetic.';

COMMENT ON COLUMN timeline_events.recorded_at IS
  'SYSTEM TIME: DB row insertion timestamp. Immutable. '
  'Used for: ingestion SLA, replay ordering, audit.';

COMMENT ON COLUMN timeline_events.event_type IS
  'Fine-grained dot-namespaced event identifier. Free text (evolves without migration). '
  'Examples: court.hearing, sentence.progressao, discipline.falta_grave';

COMMENT ON COLUMN timeline_events.amends_event_id IS
  'Points to the erroneous event this row corrects. '
  '"Current events" query: WHERE id NOT IN (SELECT amends_event_id ...) '
  'and WHERE amends_event_id IS NULL.';

COMMENT ON COLUMN timeline_events.visibility IS
  'legal=court-facing output; internal=office-only; both=both contexts. '
  'internal events NEVER appear in documents sent to courts/clients.';

-- PRIMARY TIMELINE QUERY: chronological event reconstruction
CREATE INDEX timeline_events_case_occurred_idx
  ON timeline_events (execution_case_id, occurred_at);

-- FILTERED TIMELINE: by category + time (UI grouping)
CREATE INDEX timeline_events_case_category_idx
  ON timeline_events (execution_case_id, event_category, occurred_at);

-- REPLAY RECONSTRUCTION: dual-clock compound index
-- "What was known by system on date X?" — use recorded_at as the replay boundary
CREATE INDEX timeline_events_replay_idx
  ON timeline_events (execution_case_id, recorded_at, occurred_at);

-- ORG-LEVEL AUDIT STREAM
CREATE INDEX timeline_events_org_recorded_idx
  ON timeline_events (organization_id, recorded_at);

-- AMENDMENT LOOKUP: find corrective events
CREATE INDEX timeline_events_amends_idx
  ON timeline_events (amends_event_id)
  WHERE amends_event_id IS NOT NULL;

-- =============================================================================
-- TABLE: sentence_snapshots  (APPEND-ONLY)
-- Immutable record of sentence arithmetic state at a point in time.
--
-- APPEND-ONLY: NO UPDATE, NO DELETE, NO updated_at, NO deleted_at.
-- Two-clock: effective_at = LEGAL TIME, recorded_at = SYSTEM TIME.
-- Engine reads: WHERE status='confirmed' ORDER BY effective_at DESC LIMIT 1
-- Architecture ref: data-model-v1.md §3.2, execution-engine.md §1
-- =============================================================================

CREATE TABLE sentence_snapshots (
  id                      UUID              NOT NULL DEFAULT gen_random_uuid(),
  organization_id         UUID              NOT NULL REFERENCES organizations(id),
  execution_case_id       UUID              NOT NULL REFERENCES execution_cases(id),

  -- TWO-CLOCK: NEVER conflate these
  effective_at            TIMESTAMPTZ       NOT NULL,                 -- LEGAL TIME: as-of date for arithmetic
  recorded_at             TIMESTAMPTZ       NOT NULL DEFAULT NOW(),   -- SYSTEM TIME: ingestion (immutable)

  -- Review status
  status                  snapshot_status   NOT NULL DEFAULT 'proposed',

  -- Core arithmetic (all quantities in DAYS — canonical unit)
  total_sentence_days     INTEGER           NOT NULL,                 -- Total penal debt
  served_days             INTEGER           NOT NULL DEFAULT 0,       -- Days cumpridos up to effective_at
  remission_days          INTEGER           NOT NULL DEFAULT 0,       -- Remição credits (LEP Art. 126)
  detraction_days         INTEGER           NOT NULL DEFAULT 0,       -- Detração (CPP Art. 387 §2)
  remaining_days          INTEGER           NOT NULL,                 -- Derived: total − served − remicao − detracão
  percent_served          NUMERIC(5,4)      NOT NULL,                 -- Fraction: 0.0000–1.0000

  -- Confidence
  confidence_level        confidence_level  NOT NULL DEFAULT 'unknown',

  -- Calculation provenance
  calculation_method      TEXT,                                       -- Playbook version + method description
  playbook_version_id     UUID,                                       -- Future FK when playbook_versions exists
  engine_run_id           UUID,                                       -- For engine-automated runs
  -- JSON array of Document UUIDs used as source: ["uuid1", "uuid2"]
  source_document_ids     JSONB             NOT NULL DEFAULT '[]',

  -- Human confirmation gate
  confirmed_by_user_id    UUID              REFERENCES users(id),     -- NULL until confirmed
  confirmed_at            TIMESTAMPTZ,

  -- Explanation bundle (ExplanationBundle JSON structure — see module comment)
  explanation             JSONB,

  -- Missing data flags: [{ field, impact, description }]
  missing_data_flags      JSONB             NOT NULL DEFAULT '[]',

  -- Amendment chain
  amends_snapshot_id      UUID              REFERENCES sentence_snapshots(id),

  -- Origin attribution
  created_by_user_id      UUID              REFERENCES users(id),     -- NULL for automated
  created_at              TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  CONSTRAINT sentence_snapshots_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE sentence_snapshots IS
  'APPEND-ONLY: NO UPDATE OR DELETE EVER. No updated_at. No deleted_at. '
  'Authoritative sentence arithmetic for an execution case. '
  'effective_at = LEGAL TIME (as-of date). recorded_at = SYSTEM TIME. '
  'Engine reads: WHERE status=''confirmed'' ORDER BY effective_at DESC LIMIT 1. '
  'All quantities in DAYS. percent_served is 0.0000–1.0000.';

COMMENT ON COLUMN sentence_snapshots.effective_at IS
  'LEGAL TIME: as-of date for this arithmetic. '
  'Engine uses for: progression fraction checks, deadline anchoring, benefit eligibility.';

COMMENT ON COLUMN sentence_snapshots.remaining_days IS
  'Derived: total_sentence_days − served_days − remission_days − detraction_days. '
  'Stored for query performance. Engine re-derives and flags discrepancies.';

COMMENT ON COLUMN sentence_snapshots.explanation IS
  'Structured ExplanationBundle. See execution-engine.md §8. '
  'Schema: { basis, components[{name,value,unit,confidence,sourceRefs,derivationNote}], '
  'assumptions, missingData, legalCitations }';

COMMENT ON COLUMN sentence_snapshots.playbook_version_id IS
  'Future FK to playbook_versions table (Phase 5+). Stored now for retroactive linking.';

-- PRIMARY ENGINE QUERY: latest confirmed snapshot
-- pattern: WHERE execution_case_id=? AND status='confirmed' ORDER BY effective_at DESC LIMIT 1
CREATE INDEX sentence_snapshots_case_effective_idx
  ON sentence_snapshots (execution_case_id, effective_at DESC);

-- CONFIRMATION QUEUE: snapshots pending lawyer review
CREATE INDEX sentence_snapshots_status_idx
  ON sentence_snapshots (organization_id, status)
  WHERE status = 'proposed';

-- REPLAY RECONSTRUCTION: dual-clock index
-- "Sentence arithmetic as known by system on date X"
CREATE INDEX sentence_snapshots_replay_idx
  ON sentence_snapshots (execution_case_id, recorded_at, effective_at);

-- ENGINE RUN GROUPING: all outputs from a single engine run
CREATE INDEX sentence_snapshots_engine_run_idx
  ON sentence_snapshots (engine_run_id)
  WHERE engine_run_id IS NOT NULL;
