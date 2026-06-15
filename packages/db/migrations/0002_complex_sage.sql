CREATE TYPE "public"."crawler_sync_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "crawler_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"status" "crawler_sync_status" DEFAULT 'pending' NOT NULL,
	"tribunal_name" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "crawler_sync_logs" ADD CONSTRAINT "crawler_sync_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawler_sync_logs" ADD CONSTRAINT "crawler_sync_logs_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawler_sync_logs" ADD CONSTRAINT "crawler_sync_logs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawler_sync_logs_org_status_idx" ON "crawler_sync_logs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "crawler_sync_logs_case_idx" ON "crawler_sync_logs" USING btree ("execution_case_id");