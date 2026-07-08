-- ============================================================================
-- 0013 — Notas do cliente (bloquinho de observações)
-- Anotações livres do advogado sobre um cliente, uma linha por anotação
-- (não um campo único que se sobrescreve) — editável/excluível pelo autor.
-- Hand-written + idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "client_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_updated_by_user_id_users_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_notes_client_idx" ON "client_notes" USING btree ("client_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_notes_org_idx" ON "client_notes" USING btree ("organization_id");
