-- ============================================================================
-- 0018 — financial_entries: módulo Financeiro, ledger manual por cliente
-- (pedido do Miguel 14/07/2026). Cobre honorários/parcelas/pagamentos
-- (direction='receivable') e despesas repassáveis do processo
-- (direction='expense'). Sempre editável; sempre com campo de observação.
--
-- ADITIVA E IDEMPOTENTE: só CREATE ... IF NOT EXISTS, não toca em nenhuma
-- tabela/dado existente. Segura pra aplicar isolada no banco de produção sem
-- rodar o run-migrations.js (que faz DROP SCHEMA — jamais em prod).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "financial_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "client_id" uuid NOT NULL REFERENCES "clients"("id"),
  "execution_case_id" uuid REFERENCES "execution_cases"("id"),
  "direction" text NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "due_date" date,
  "paid_at" timestamptz,
  "payment_method" text,
  "status" text NOT NULL DEFAULT 'pending',
  "notes" text,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "financial_entries_org_client_idx" ON "financial_entries" ("organization_id", "client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_entries_org_status_due_idx" ON "financial_entries" ("organization_id", "status", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_entries_case_idx" ON "financial_entries" ("execution_case_id");
