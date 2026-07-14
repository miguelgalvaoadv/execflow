-- ============================================================================
-- 0017 — calendar_events: agenda própria do escritório (pedido do Miguel
-- 13/07/2026). Eventos manuais (audiência/reunião/lembrete) + vínculos a
-- prazos/oportunidades ("Adicionar à agenda"). Prazos e oportunidades NÃO são
-- copiados pra cá — já têm data própria e são agregados na leitura.
--
-- ADITIVA E IDEMPOTENTE: só CREATE ... IF NOT EXISTS, não toca em nenhuma
-- tabela/dado existente. Segura pra aplicar isolada no banco de produção sem
-- rodar o run-migrations.js (que faz DROP SCHEMA — jamais em prod).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "execution_case_id" uuid REFERENCES "execution_cases"("id"),
  "title" text NOT NULL,
  "description" text,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz,
  "all_day" boolean NOT NULL DEFAULT true,
  "location" text,
  "event_kind" text NOT NULL DEFAULT 'manual',
  "color" text,
  "source_type" text,
  "source_deadline_id" uuid REFERENCES "deadlines"("id"),
  "source_opportunity_id" uuid REFERENCES "opportunities"("id"),
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "calendar_events_org_start_idx" ON "calendar_events" ("organization_id", "starts_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_case_idx" ON "calendar_events" ("execution_case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_source_deadline_idx" ON "calendar_events" ("source_deadline_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_source_opportunity_idx" ON "calendar_events" ("source_opportunity_id");
