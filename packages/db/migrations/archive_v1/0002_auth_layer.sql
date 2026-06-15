-- =============================================================================
-- EXECFLOW — Migration 0002: Auth Layer
-- =============================================================================
-- Phase: 2 — Authentication, authorization, and tenancy foundation.
-- Creates: ba_user, ba_session, ba_account, ba_verification (Better Auth tables)
--
-- DESIGN: Two-table user model.
--   ba_user  → Better Auth owns: sessions, passwords, OAuth, impersonation state
--   users    → EXECFLOW owns: legal attribution, bar number, status, org roles
--
-- The two tables share the same UUID value in their IDs.
-- ba_user.id is TEXT storing a UUID string.
-- users.id   is UUID PostgreSQL native type.
-- PostgreSQL handles the implicit cast in join conditions.
--
-- BRIDGE: packages/auth databaseHooks create the matching `users` record when
-- Better Auth creates a ba_user record. IDs are always kept in 1:1 correspondence.
--
-- IMMUTABILITY:
-- ba_session rows may be deleted (sign-out, expiry cleanup) — they are not legal history.
-- ba_verification rows are deleted after successful use.
-- ba_user and ba_account rows are soft-managed by Better Auth.
-- None of these tables require append-only protection.
-- =============================================================================

-- =============================================================================
-- ba_user — Better Auth user identity table
-- =============================================================================
CREATE TABLE ba_user (
  id                TEXT        PRIMARY KEY,
  name              TEXT        NOT NULL,
  email             TEXT        NOT NULL,
  email_verified    BOOLEAN     NOT NULL DEFAULT FALSE,
  image             TEXT,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,

  -- Admin plugin fields
  role              TEXT,
  banned            BOOLEAN,
  ban_reason        TEXT,
  ban_expires       TIMESTAMPTZ
);

CREATE UNIQUE INDEX ba_user_email_unique ON ba_user (email);
CREATE INDEX ba_user_email_idx ON ba_user (email);

COMMENT ON TABLE ba_user IS
  'Better Auth authentication user. Auth layer identity (sessions, passwords, OAuth). '
  'Paired 1:1 with a users record via matching UUID. '
  'See migration 0001 for users table (domain attribution).';

COMMENT ON COLUMN ba_user.role IS
  'Platform-level role set by Better Auth admin plugin. NOT the org membership role. '
  '''user'' (default) | ''admin'' (platform admin with impersonation rights). '
  'Org-level roles (admin, lawyer, assistant) live in the memberships table.';

COMMENT ON COLUMN ba_user.ban_expires IS
  'When the ban expires. NULL = permanent ban. '
  'Better Auth auto-lifts bans past this date on next session creation attempt.';

-- =============================================================================
-- ba_session — Better Auth session table
-- =============================================================================
CREATE TABLE ba_session (
  id                        TEXT        PRIMARY KEY,
  expires_at                TIMESTAMPTZ NOT NULL,
  token                     TEXT        NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL,
  updated_at                TIMESTAMPTZ NOT NULL,
  ip_address                TEXT,
  user_agent                TEXT,
  user_id                   TEXT        NOT NULL REFERENCES ba_user (id) ON DELETE CASCADE,

  -- Custom: active org for frontend state restoration
  active_organization_id    TEXT,

  -- Admin plugin: impersonation attribution
  -- When non-null: actorType must be 'admin_impersonating' for ALL audit entries.
  -- Contains the ba_user.id of the admin who initiated impersonation.
  -- NEVER attribute impersonated actions to user_id when this is set.
  impersonated_by           TEXT
);

CREATE UNIQUE INDEX ba_session_token_unique ON ba_session (token);
CREATE INDEX ba_session_user_idx ON ba_session (user_id);
CREATE INDEX ba_session_expires_idx ON ba_session (expires_at);

COMMENT ON TABLE ba_session IS
  'Better Auth session. Every authenticated request is validated against this table. '
  'Sessions expire after 7 days. Sign-out deletes the session row.';

COMMENT ON COLUMN ba_session.active_organization_id IS
  'UUID string of the currently active organization. '
  'Set via PUT /api/v1/me/session/active-organization. '
  'API middleware uses X-Organization-Id header primarily; this is fallback.';

COMMENT ON COLUMN ba_session.impersonated_by IS
  'admin_impersonating attribution. Set by Better Auth admin plugin ONLY. '
  'Value is the ba_user.id of the admin who called POST /api/auth/admin/impersonate-user. '
  'Architecture ref: technical-stack-decision.md §5.1 (impersonation safety model).';

-- =============================================================================
-- ba_account — Better Auth OAuth provider accounts
-- =============================================================================
CREATE TABLE ba_account (
  id                          TEXT        PRIMARY KEY,
  account_id                  TEXT        NOT NULL,
  provider_id                 TEXT        NOT NULL,
  user_id                     TEXT        NOT NULL REFERENCES ba_user (id) ON DELETE CASCADE,
  access_token                TEXT,
  refresh_token               TEXT,
  id_token                    TEXT,
  access_token_expires_at     TIMESTAMPTZ,
  refresh_token_expires_at    TIMESTAMPTZ,
  scope                       TEXT,
  -- bcrypt-hashed password for credential accounts. NEVER raw. NEVER in API responses.
  password                    TEXT,
  created_at                  TIMESTAMPTZ NOT NULL,
  updated_at                  TIMESTAMPTZ NOT NULL
);

CREATE INDEX ba_account_user_idx ON ba_account (user_id);
CREATE INDEX ba_account_provider_idx ON ba_account (provider_id, account_id);

COMMENT ON TABLE ba_account IS
  'Better Auth OAuth/credential account. One row per authentication method per user. '
  'credential provider: password is bcrypt-hashed. OAuth: stores tokens. '
  'LGPD: password hash and OAuth tokens are sensitive — access restricted to auth layer.';

-- =============================================================================
-- ba_verification — Better Auth email verification tokens
-- =============================================================================
CREATE TABLE ba_verification (
  id              TEXT        PRIMARY KEY,
  identifier      TEXT        NOT NULL,
  value           TEXT        NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
);

CREATE INDEX ba_verification_identifier_idx ON ba_verification (identifier);
CREATE INDEX ba_verification_expires_idx ON ba_verification (expires_at);

COMMENT ON TABLE ba_verification IS
  'Better Auth short-lived verification tokens. '
  'Used for email verification, password reset, magic links. '
  'Rows are deleted after successful verification. Not append-only.';

-- =============================================================================
-- END OF MIGRATION 0002
-- =============================================================================
-- Next migration: 0003_core_entities.sql — Client, ExecutionCase, PrisonUnit
-- (Phase 3 — Core case management entities)
-- Architecture ref: IMPLEMENTATION_ORDER.md §3.
-- =============================================================================
