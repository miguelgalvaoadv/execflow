-- ============================================================================
-- 0015 — case_analysis_runs: rastreia execuções assíncronas de "Analisar
-- autos" (IA). Achado 08/07/2026: a rota /analyze era síncrona e a chamada
-- ao Claude leva 60-120s+ pra PDFs reais — isso atravessa o proxy do Next.js
-- (rewrites), que corta a conexão em requisições longas e devolve "Internal
-- Server Error" ao navegador mesmo quando o backend termina com sucesso
-- (confirmado testando o caso real do Marcelo: hit direto na API deu 200,
-- hit pelo proxy do Next deu 500). Corrigido: /analyze agora responde 202 na
-- hora e roda em segundo plano; o front faz polling neste registro, igual ao
-- padrão já usado em crawler_sync_logs.
-- Hand-written + idempotente (drizzle-kit generate exige TTY interativo,
-- indisponível neste ambiente).
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "case_analysis_status" AS ENUM ('pending', 'running', 'success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "case_analysis_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "execution_case_id" uuid NOT NULL,
  "status" "case_analysis_status" DEFAULT 'pending' NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "result" jsonb,
  "error_details" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" uuid
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "case_analysis_runs" ADD CONSTRAINT "case_analysis_runs_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "case_analysis_runs" ADD CONSTRAINT "case_analysis_runs_execution_case_id_execution_cases_id_fk"
    FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "case_analysis_runs" ADD CONSTRAINT "case_analysis_runs_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "case_analysis_runs_org_status_idx" ON "case_analysis_runs" USING btree ("organization_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "case_analysis_runs_case_idx" ON "case_analysis_runs" USING btree ("execution_case_id", "created_at");
