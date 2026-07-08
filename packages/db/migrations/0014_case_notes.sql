-- ============================================================================
-- 0014 — Move client_notes → case_notes (observações por EXECUÇÃO, não por
-- cliente — pedido do Miguel: um cliente pode ter mais de um processo, e a
-- observação é sobre o processo específico, junto de Prazos/Cálculos/etc.)
-- Tabela client_notes é novíssima (migração 0013, sem dado real usado em
-- produção) — renomeia limpo em vez de criar do zero.
-- Hand-written + idempotente.
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE "client_notes" RENAME TO "case_notes";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "case_notes" RENAME COLUMN "client_id" TO "execution_case_id";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "case_notes" DROP CONSTRAINT "client_notes_client_id_clients_id_fk";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_execution_case_id_execution_cases_id_fk"
    FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DROP INDEX IF EXISTS "client_notes_client_idx";
--> statement-breakpoint

DROP INDEX IF EXISTS "client_notes_org_idx";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "case_notes_case_idx" ON "case_notes" USING btree ("execution_case_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "case_notes_org_idx" ON "case_notes" USING btree ("organization_id");
