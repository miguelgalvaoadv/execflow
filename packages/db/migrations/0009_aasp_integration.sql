-- Migration 0009: AASP integration + document freshness gate
-- Hand-written (drizzle-kit generate is blocked in this environment due to orphaned crawler_configs table).

-- (1) New value for health_check_type enum
-- ALTER TYPE ... ADD VALUE cannot be rolled back in Postgres, but is safe to run idempotently.
ALTER TYPE "public"."health_check_type" ADD VALUE IF NOT EXISTS 'aasp_webhook_received';
--> statement-breakpoint

-- (2) Document freshness fields on execution_cases
-- document_freshness_status: 'fresh' | 'stale' | 'unknown'
--   fresh   = autos loaded + no critical movement since last load
--   stale   = tier-1 or tier-2 movement arrived after last autos load → blocks piece generation
--   unknown = no autos ever loaded → warns but does not block
-- pending_critical_movement_since / _type: set when status goes stale, cleared on new autos
ALTER TABLE "execution_cases"
  ADD COLUMN IF NOT EXISTS "document_freshness_status" text,
  ADD COLUMN IF NOT EXISTS "autos_last_ingested_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "pending_critical_movement_since" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "pending_critical_movement_type" text;
--> statement-breakpoint

-- (3) Criticality tier on timeline_events
-- '1' = invalidates autos (regression, extinction, new calc, revocation)
-- '2' = relevant but does not invalidate (progression pending, hearing, partial remission)
-- '3' = procedural/informational (views, loads, certificates, expedited writ)
-- null = not classified / non-movement event
ALTER TABLE "timeline_events"
  ADD COLUMN IF NOT EXISTS "criticality_tier" text;
