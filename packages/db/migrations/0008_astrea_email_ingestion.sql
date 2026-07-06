CREATE TYPE "public"."astrea_email_status" AS ENUM('processed', 'orphan', 'parse_failed', 'duplicate', 'ignored_no_cnj');--> statement-breakpoint
CREATE TYPE "public"."astrea_extraction_method" AS ENUM('regex', 'claude_haiku', 'failed');--> statement-breakpoint
CREATE TYPE "public"."health_check_type" AS ENUM('astrea_email_poll');--> statement-breakpoint
CREATE TYPE "public"."health_check_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "astrea_email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" text,
	"content_hash" text NOT NULL,
	"email_subject" text,
	"email_from" text,
	"email_received_at" timestamp with time zone,
	"raw_body_snapshot" text,
	"status" "astrea_email_status" NOT NULL,
	"extraction_method" "astrea_extraction_method",
	"extracted_cnj" text,
	"extracted_data" jsonb,
	"matched_execution_case_id" uuid,
	"timeline_events_created" integer DEFAULT 0 NOT NULL,
	"error_details" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"review_notes" text,
	"moved_to_folder" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"check_type" "health_check_type" NOT NULL,
	"status" "health_check_status" NOT NULL,
	"emails_found" integer DEFAULT 0 NOT NULL,
	"emails_processed" integer DEFAULT 0 NOT NULL,
	"emails_orphan" integer DEFAULT 0 NOT NULL,
	"emails_parse_failed" integer DEFAULT 0 NOT NULL,
	"error_details" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_cases" ADD COLUMN "astrea_sealed_credential_status" text;--> statement-breakpoint
ALTER TABLE "execution_cases" ADD COLUMN "astrea_sealed_credential_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_cases" ADD COLUMN "astrea_sealed_credential_review_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "astrea_email_logs" ADD CONSTRAINT "astrea_email_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "astrea_email_logs" ADD CONSTRAINT "astrea_email_logs_matched_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("matched_execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "astrea_email_logs" ADD CONSTRAINT "astrea_email_logs_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_health_checks" ADD CONSTRAINT "system_health_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "astrea_email_logs_message_id_unique" ON "astrea_email_logs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "astrea_email_logs_content_hash_idx" ON "astrea_email_logs" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "astrea_email_logs_org_status_idx" ON "astrea_email_logs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "astrea_email_logs_status_created_idx" ON "astrea_email_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "astrea_email_logs_cnj_idx" ON "astrea_email_logs" USING btree ("extracted_cnj");--> statement-breakpoint
CREATE INDEX "system_health_checks_org_type_created_idx" ON "system_health_checks" USING btree ("organization_id","check_type","created_at");
