-- ============================================================================
-- 0010 — Painel Jurídico Inteligente
-- Inventário por OAB, partes do processo, intimações estruturadas,
-- conectores de integração, histórico de IA + prioridade/validação de cadastro.
-- Hand-written (drizzle-kit generate bloqueado — ver 0009). Idempotente.
-- ============================================================================

-- (1) Inventário por OAB — perfis
CREATE TABLE IF NOT EXISTS "oab_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lawyer_name" text NOT NULL,
	"oab_number" text NOT NULL,
	"oab_uf" text NOT NULL,
	"primary_tribunal" text,
	"primary_system" text,
	"search_source" text DEFAULT 'csv_import' NOT NULL,
	"search_status" text DEFAULT 'never_synced' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- (2) Inventário por OAB — itens (antessala do ExecutionCase)
CREATE TABLE IF NOT EXISTS "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"oab_profile_id" uuid,
	"process_number" text NOT NULL,
	"tribunal" text,
	"degree" text,
	"system" text,
	"comarca" text,
	"vara" text,
	"court_class" text,
	"area" text,
	"situation" text,
	"parties_text" text,
	"link" text,
	"last_movement_text" text,
	"last_movement_at" timestamp with time zone,
	"priority" text,
	"priority_reason" text,
	"needs_autos" boolean DEFAULT false NOT NULL,
	"autos_downloaded" boolean DEFAULT false NOT NULL,
	"is_sealed" boolean DEFAULT false NOT NULL,
	"review_status" text DEFAULT 'unreviewed' NOT NULL,
	"client_id" uuid,
	"execution_case_id" uuid,
	"source_info" text DEFAULT 'manual' NOT NULL,
	"import_batch_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- (3) Partes do processo
CREATE TABLE IF NOT EXISTS "case_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"name" text NOT NULL,
	"participation_type" text NOT NULL,
	"cpf" text,
	"oab" text,
	"confidence" text DEFAULT 'suggested' NOT NULL,
	"source_document_id" uuid,
	"source_reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- (4) Intimações / publicações / comunicações oficiais
CREATE TABLE IF NOT EXISTS "court_communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid,
	"inventory_item_id" uuid,
	"process_number" text,
	"kind" text DEFAULT 'intimacao' NOT NULL,
	"source" text NOT NULL,
	"content" text,
	"lawyer_name" text,
	"available_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"possible_deadline" boolean DEFAULT false NOT NULL,
	"deadline_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"raw_payload" jsonb,
	"content_hash" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- (5) Conectores de integração (estado honesto por fonte)
CREATE TABLE IF NOT EXISTS "integration_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'pending_credential' NOT NULL,
	"has_credential" boolean DEFAULT false NOT NULL,
	"manual_import_available" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"records_imported" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"config_json" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- (6) Histórico de interações com a IA (auditoria LGPD)
CREATE TABLE IF NOT EXISTS "ai_interaction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"model" text NOT NULL,
	"prompt_text" text,
	"response_text" text,
	"execution_case_id" uuid,
	"client_id" uuid,
	"document_id" uuid,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" numeric(10, 6),
	"status" text NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- (7) Colunas novas em execution_cases (prioridade operacional)
ALTER TABLE "execution_cases"
	ADD COLUMN IF NOT EXISTS "priority" text,
	ADD COLUMN IF NOT EXISTS "priority_reason" text;
--> statement-breakpoint

-- (8) Colunas novas em clients (origem/validação do cadastro sugerido)
ALTER TABLE "clients"
	ADD COLUMN IF NOT EXISTS "registration_origin" text DEFAULT 'manual' NOT NULL,
	ADD COLUMN IF NOT EXISTS "validated_by_user_id" uuid,
	ADD COLUMN IF NOT EXISTS "validated_at" timestamp with time zone;
--> statement-breakpoint

-- (9) Foreign keys (idempotentes via DO block)
DO $$ BEGIN
	ALTER TABLE "oab_profiles" ADD CONSTRAINT "oab_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oab_profiles" ADD CONSTRAINT "oab_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_oab_profile_id_oab_profiles_id_fk" FOREIGN KEY ("oab_profile_id") REFERENCES "public"."oab_profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "court_communications" ADD CONSTRAINT "court_communications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "court_communications" ADD CONSTRAINT "court_communications_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "court_communications" ADD CONSTRAINT "court_communications_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "court_communications" ADD CONSTRAINT "court_communications_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "integration_connectors" ADD CONSTRAINT "integration_connectors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "clients" ADD CONSTRAINT "clients_validated_by_user_id_users_id_fk" FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- (10) Índices
CREATE UNIQUE INDEX IF NOT EXISTS "oab_profiles_org_oab_unique" ON "oab_profiles" USING btree ("organization_id","oab_number","oab_uf");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_org_process_unique" ON "inventory_items" USING btree ("organization_id","process_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_org_priority_idx" ON "inventory_items" USING btree ("organization_id","priority","review_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_profile_idx" ON "inventory_items" USING btree ("oab_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_client_idx" ON "inventory_items" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_parties_case_idx" ON "case_parties" USING btree ("execution_case_id","participation_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_parties_org_idx" ON "case_parties" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "court_communications_hash_unique" ON "court_communications" USING btree ("organization_id","content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "court_communications_case_idx" ON "court_communications" USING btree ("execution_case_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "court_communications_org_status_idx" ON "court_communications" USING btree ("organization_id","status","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "court_communications_process_idx" ON "court_communications" USING btree ("organization_id","process_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connectors_org_kind_unique" ON "integration_connectors" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_interaction_logs_org_created_idx" ON "ai_interaction_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_interaction_logs_case_idx" ON "ai_interaction_logs" USING btree ("execution_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_interaction_logs_agent_idx" ON "ai_interaction_logs" USING btree ("organization_id","agent");
