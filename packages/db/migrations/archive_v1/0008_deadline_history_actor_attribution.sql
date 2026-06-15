-- ============================================================================
-- Migration 0008: deadline_history actor attribution model
--
-- PURPOSE:
-- Align deadline_history with opportunity_status_history, domain_events,
-- audit_logs, queue_escalations, and timeline_events — explicit actor_type +
-- actor_id for human and system transitions.
--
-- Brownfield:
-- - Add changed_by_actor_type / changed_by_actor_id
-- - Backfill existing rows from changed_by_user_id (actor_type='user')
-- - Drop NOT NULL on changed_by_user_id (derived denorm for humans only)
-- - Fail if any row lacks actor attribution after backfill
--
-- causing_event_id already exists from migration 0004 — unchanged.
-- ============================================================================

BEGIN;

ALTER TABLE deadline_history
  ADD COLUMN IF NOT EXISTS changed_by_actor_type TEXT,
  ADD COLUMN IF NOT EXISTS changed_by_actor_id TEXT;

UPDATE deadline_history
SET
  changed_by_actor_type = 'user',
  changed_by_actor_id = changed_by_user_id::text
WHERE changed_by_actor_type IS NULL
  AND changed_by_user_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM deadline_history
    WHERE changed_by_actor_type IS NULL
       OR changed_by_actor_id IS NULL
       OR btrim(changed_by_actor_type) = ''
       OR btrim(changed_by_actor_id) = ''
  ) THEN
    RAISE EXCEPTION
      'migration 0008: deadline_history rows lack actor attribution after backfill — manual intervention required';
  END IF;
END $$;

ALTER TABLE deadline_history
  ALTER COLUMN changed_by_actor_type SET NOT NULL,
  ALTER COLUMN changed_by_actor_id SET NOT NULL;

ALTER TABLE deadline_history
  ALTER COLUMN changed_by_user_id DROP NOT NULL;

COMMENT ON COLUMN deadline_history.changed_by_actor_type IS
  'Actor type: user | system | agent_* — canonical attribution (matches domain_events).';
COMMENT ON COLUMN deadline_history.changed_by_actor_id IS
  'Actor identifier: users.id UUID when user; worker name when system.';
COMMENT ON COLUMN deadline_history.changed_by_user_id IS
  'Optional denormalization when changed_by_actor_type=user; NULL for system transitions.';

COMMIT;
