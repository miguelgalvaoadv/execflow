CREATE TYPE "public"."piece_draft_status" AS ENUM('generating', 'draft', 'reviewing', 'finalized');--> statement-breakpoint
CREATE TABLE "piece_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"status" "piece_draft_status" DEFAULT 'generating' NOT NULL,
	"content_markdown" text,
	"model_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"finalized_at" timestamp with time zone,
	"finalized_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "piece_drafts" ADD CONSTRAINT "piece_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_drafts" ADD CONSTRAINT "piece_drafts_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_drafts" ADD CONSTRAINT "piece_drafts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_drafts" ADD CONSTRAINT "piece_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_drafts" ADD CONSTRAINT "piece_drafts_finalized_by_user_id_users_id_fk" FOREIGN KEY ("finalized_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "piece_drafts_org_status_idx" ON "piece_drafts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "piece_drafts_opp_idx" ON "piece_drafts" USING btree ("opportunity_id");