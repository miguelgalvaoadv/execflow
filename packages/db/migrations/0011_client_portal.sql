-- ============================================================================
-- 0011 — Portal do cliente
-- Role 'client' no enum de membership + vínculo membership→client.
-- Hand-written (drizzle-kit generate bloqueado). Idempotente. Forward-only
-- (ADD VALUE em enum não tem rollback no Postgres).
-- ============================================================================

ALTER TYPE "public"."membership_role" ADD VALUE IF NOT EXISTS 'client';
--> statement-breakpoint

ALTER TABLE "memberships"
	ADD COLUMN IF NOT EXISTS "linked_client_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "memberships" ADD CONSTRAINT "memberships_linked_client_id_clients_id_fk" FOREIGN KEY ("linked_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
