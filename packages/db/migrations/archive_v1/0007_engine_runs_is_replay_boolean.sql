-- ============================================================================
-- Migration 0007: engine_runs.is_replay JSONB → BOOLEAN (brownfield only)
--
-- PURPOSE:
-- Environments that applied migration 0006 before the JSONB→BOOLEAN fix
-- require an explicit forward-only conversion. Greenfield installs that
-- received the corrected 0006 skip this migration (column already boolean).
--
-- RULES:
-- - Fail explicitly if any row contains JSONB other than true/false
-- - No coercion, no fallback, no silent compatibility
-- - Unexpected column types abort the migration
-- ============================================================================

BEGIN;

DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'engine_runs'
    AND column_name = 'is_replay';

  IF col_type IS NULL THEN
    RETURN;
  END IF;

  IF col_type = 'boolean' THEN
    RETURN;
  END IF;

  IF col_type <> 'jsonb' THEN
    RAISE EXCEPTION
      'migration 0007: engine_runs.is_replay has unexpected type % — manual intervention required',
      col_type;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM engine_runs
    WHERE is_replay IS NOT NULL
      AND is_replay NOT IN ('true'::jsonb, 'false'::jsonb)
  ) THEN
    RAISE EXCEPTION
      'migration 0007: engine_runs.is_replay contains invalid JSONB values — migration aborted';
  END IF;

  ALTER TABLE engine_runs
    ALTER COLUMN is_replay DROP DEFAULT;

  ALTER TABLE engine_runs
    ALTER COLUMN is_replay TYPE BOOLEAN
    USING (is_replay = 'true'::jsonb);

  ALTER TABLE engine_runs
    ALTER COLUMN is_replay SET DEFAULT FALSE;

  ALTER TABLE engine_runs
    ALTER COLUMN is_replay SET NOT NULL;
END $$;

COMMIT;
