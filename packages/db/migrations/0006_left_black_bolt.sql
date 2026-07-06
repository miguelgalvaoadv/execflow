ALTER TABLE "execution_cases" ADD COLUMN "monitoring_status" text;--> statement-breakpoint
ALTER TABLE "execution_cases" ADD COLUMN "last_synced_at" timestamp with time zone;