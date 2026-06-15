CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent_ingestion', 'agent_analysis', 'agent_drafting', 'agent_notification', 'system', 'admin_impersonating');--> statement-breakpoint
CREATE TYPE "public"."case_kind" AS ENUM('primary', 'apenso', 'incident', 'parallel');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('intake', 'active', 'suspended', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'inactive', 'merged', 'archived');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."deadline_class" AS ENUM('legal', 'benefit', 'disciplinary', 'calculation', 'internal', 'recurring', 'sla');--> statement-breakpoint
CREATE TYPE "public"."deadline_origin" AS ENUM('manual', 'extracted', 'rule', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."deadline_priority" AS ENUM('critical', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."deadline_status" AS ENUM('open', 'acknowledged', 'overdue', 'completed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending_association', 'pending_extraction', 'extraction_running', 'extraction_review', 'confirmed', 'archived', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."engine_run_status" AS ENUM('running', 'completed', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."engine_run_trigger" AS ENUM('manual', 'timeline_event', 'snapshot_superseded', 'custody_snapshot', 'document_associated', 'playbook_published', 'recalculation', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."escalation_trigger" AS ENUM('sla_breach', 'overdue_legal', 'liberty_risk', 'unacknowledged', 'blocking_unresolved', 'manual', 'repeated_failure');--> statement-breakpoint
CREATE TYPE "public"."event_processing_status" AS ENUM('pending', 'published', 'failed', 'dead_lettered');--> statement-breakpoint
CREATE TYPE "public"."intake_bundle_status" AS ENUM('received', 'extraction_pending', 'extraction_review', 'association_review', 'execution_active', 'failed_ocr', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."intake_source_channel" AS ENUM('intake_manual', 'intake_pdf', 'intake_scan', 'intake_whatsapp', 'intake_email', 'intake_api', 'intake_tribunal');--> statement-breakpoint
CREATE TYPE "public"."legal_fraction" AS ENUM('1/6', '1/4', '2/5', '3/5', '16%', '20%', '25%', '30%', '40%', '50%', '60%', '70%');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('admin', 'lawyer', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'invited', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."ocr_status" AS ENUM('not_applicable', 'pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."opportunity_review_action" AS ENUM('qualified', 'rejected', 'changes_requested', 'deferred', 'escalated', 'pursuing_started', 'realized');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('suggested', 'qualified', 'pursuing', 'realized', 'dismissed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('progression', 'remission', 'detraction', 'amnesty', 'commutation', 'hc', 'pad_challenge', 'prescription', 'recalculation', 'excess_execution', 'rights_violation', 'manual');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."playbook_status" AS ENUM('draft', 'review', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."queue_projection_status" AS ENUM('active', 'snoozed', 'deferred', 'blocked', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."queue_type" AS ENUM('intake_review', 'extraction_review', 'missing_data', 'progression_opportunities', 'pad_defense', 'overdue_deadlines', 'pending_filings', 'recalculation_conflicts', 'ai_review', 'urgent_liberty_risks', 'opportunity_review', 'snapshot_review', 'workflow_tasks');--> statement-breakpoint
CREATE TYPE "public"."recalculation_run_status" AS ENUM('scheduled', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."regime_type" AS ENUM('fechado', 'semiaberto', 'aberto', 'albergue', 'domiciliar', 'provisorio', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."rule_outcome" AS ENUM('opportunity_suggested', 'opportunity_blocked', 'insufficient_data', 'warning', 'snapshot_proposal', 'no_match');--> statement-breakpoint
CREATE TYPE "public"."sensitivity_level" AS ENUM('public', 'standard', 'sensitive', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."snapshot_dependency_type" AS ENUM('sentence_snapshot', 'custody_snapshot', 'timeline_event', 'document', 'playbook_version');--> statement-breakpoint
CREATE TYPE "public"."snapshot_status" AS ENUM('proposed', 'confirmed', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."strategy_profile" AS ENUM('conservative', 'standard', 'aggressive');--> statement-breakpoint
CREATE TYPE "public"."timeline_event_category" AS ENUM('court', 'prison', 'sentence', 'benefit', 'legal_action', 'document', 'ai', 'internal', 'system');--> statement-breakpoint
CREATE TYPE "public"."timeline_event_source" AS ENUM('manual', 'document', 'integration', 'ai_suggestion', 'system_rule');--> statement-breakpoint
CREATE TYPE "public"."timeline_visibility" AS ENUM('legal', 'internal', 'both');--> statement-breakpoint
CREATE TYPE "public"."uncertainty_level" AS ENUM('none', 'low', 'medium', 'high', 'blocking');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_status" AS ENUM('pending', 'claimed', 'released', 'in_progress', 'blocked', 'completed', 'cancelled', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_type" AS ENUM('review_extraction', 'confirm_document', 'prepare_piece', 'collect_missing_data', 'confirm_filing', 'review_opportunity', 'case_health_review', 'deadline_action', 'intake_triage', 'follow_up', 'recalculation_review', 'pad_defense', 'generic');--> statement-breakpoint
CREATE TYPE "public"."extraction_run_status" AS ENUM('requested', 'running', 'review', 'confirmed', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ocr_run_status" AS ENUM('requested', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_subject_type" AS ENUM('extraction', 'snapshot');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."snapshot_promotion_status" AS ENUM('requested', 'proposed', 'confirmed', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text,
	"impersonating_user_id" uuid,
	"model_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changes" jsonb,
	"metadata" jsonb,
	"ip_address" text,
	"session_id" text,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "ba_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ba_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "ba_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "ba_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "ba_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ba_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "case_playbook_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"branch_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"strategy_profile" "strategy_profile",
	"reason" text NOT NULL,
	"set_by_user_id" uuid NOT NULL,
	"valid_until" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_by_context_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"cpf" text,
	"rg" text,
	"birth_date" date,
	"display_name" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal_ref" text,
	"responsible_lawyer_user_id" uuid NOT NULL,
	"contact_channels" jsonb,
	"notes" text,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"merged_into_client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "execution_custody_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"regime" "regime_type" NOT NULL,
	"prison_unit_id" uuid,
	"effective_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
	"source_event_id" uuid,
	"notes" text,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejected_by_user_id" uuid,
	"superseded_at" timestamp with time zone,
	"superseded_by_snapshot_id" uuid,
	"amends_snapshot_id" uuid
);
--> statement-breakpoint
CREATE TABLE "deadline_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deadline_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"changed_by_actor_type" text NOT NULL,
	"changed_by_actor_id" text NOT NULL,
	"changed_by_user_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"causing_event_id" uuid,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp with time zone NOT NULL,
	"deadline_class" "deadline_class" NOT NULL,
	"origin" "deadline_origin" NOT NULL,
	"priority" "deadline_priority" DEFAULT 'normal' NOT NULL,
	"status" "deadline_status" DEFAULT 'open' NOT NULL,
	"assignee_user_id" uuid,
	"source_event_id" uuid,
	"source_document_id" uuid,
	"playbook_version_id" uuid,
	"legal_basis" text,
	"parent_deadline_id" uuid,
	"recurrence_pattern" jsonb,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"escalated_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"completion_evidence_type" text,
	"completion_evidence_id" text,
	"dismissed_at" timestamp with time zone,
	"dismissed_by_user_id" uuid,
	"dismissed_reason" text,
	"dismissed_reason_code" text,
	"blocking_reason" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_extraction_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"extraction_type" text NOT NULL,
	"structured_data" jsonb NOT NULL,
	"confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_ocr_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ocr_run_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"page_count" integer DEFAULT 1 NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"execution_case_id" uuid,
	"intake_bundle_id" uuid,
	"document_class" text,
	"storage_key" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_name" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"status" "document_status" DEFAULT 'pending_association' NOT NULL,
	"source_channel" "intake_source_channel" NOT NULL,
	"ocr_status" "ocr_status" DEFAULT 'pending' NOT NULL,
	"sensitivity_level" "sensitivity_level" DEFAULT 'standard' NOT NULL,
	"supersedes_document_id" uuid,
	"whatsapp_forwarded_from" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"uploaded_at" timestamp with time zone NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"causation_id" uuid,
	"correlation_id" uuid NOT NULL,
	"organization_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb,
	"replayable" boolean DEFAULT true NOT NULL,
	"processing_status" "event_processing_status" DEFAULT 'pending' NOT NULL,
	"published_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error_message" text,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "engine_rule_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"engine_run_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"playbook_version_id" uuid NOT NULL,
	"rule_group_id" text,
	"branch_id" text,
	"evaluator_id" text NOT NULL,
	"evaluation_order" integer NOT NULL,
	"inputs_hash" text NOT NULL,
	"outputs_hash" text NOT NULL,
	"inputs_snapshot" jsonb,
	"outputs_snapshot" jsonb,
	"outcome" "rule_outcome" NOT NULL,
	"uncertainty_level" "uncertainty_level" DEFAULT 'none' NOT NULL,
	"blocking_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertainty_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_data_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"playbook_version_id" uuid NOT NULL,
	"overlay_version_id" uuid,
	"case_context_id" uuid,
	"strategy_profile" "strategy_profile" DEFAULT 'standard' NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" "engine_run_status" DEFAULT 'running' NOT NULL,
	"trigger" "engine_run_trigger" NOT NULL,
	"trigger_entity_type" text,
	"trigger_entity_id" uuid,
	"requested_by_user_id" uuid,
	"uncertainty_level" "uncertainty_level" DEFAULT 'none' NOT NULL,
	"blocking_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_data_summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opportunities_created" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings_emitted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_details" text,
	"is_replay" boolean DEFAULT false NOT NULL,
	"superseded_by_run_id" uuid,
	"correlation_id" uuid,
	"causation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"internal_ref" text NOT NULL,
	"execution_process_number" text,
	"origin_process_number" text,
	"court_name" text,
	"court_jurisdiction" text,
	"case_kind" "case_kind" DEFAULT 'primary' NOT NULL,
	"parent_execution_case_id" uuid,
	"case_status" "case_status" DEFAULT 'intake' NOT NULL,
	"responsible_lawyer_user_id" uuid NOT NULL,
	"sentence_summary" text,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"process_number_pending_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "explanation_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"engine_run_id" uuid,
	"payload" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ocr_run_id" uuid NOT NULL,
	"ocr_result_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"status" "extraction_run_status" DEFAULT 'requested' NOT NULL,
	"extraction_type" text DEFAULT 'generic' NOT NULL,
	"provider_id" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"trigger_event_id" uuid,
	"correlation_id" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_channel" "intake_source_channel" NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"uploader_user_id" uuid NOT NULL,
	"status" "intake_bundle_status" DEFAULT 'received' NOT NULL,
	"proposed_client_id" uuid,
	"proposed_execution_case_id" uuid,
	"associated_client_id" uuid,
	"associated_execution_case_id" uuid,
	"associated_at" timestamp with time zone,
	"associated_by_user_id" uuid,
	"file_count" integer DEFAULT 0 NOT NULL,
	"missing_fields" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocr_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"status" "ocr_run_status" DEFAULT 'requested' NOT NULL,
	"provider_id" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"trigger_event_id" uuid,
	"correlation_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"opportunity_type" "opportunity_type" NOT NULL,
	"status" "opportunity_status" DEFAULT 'suggested' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_at" timestamp with time zone,
	"qualified_by_user_id" uuid,
	"window_start_at" timestamp with time zone,
	"window_end_at" timestamp with time zone,
	"summary" text NOT NULL,
	"rationale" text,
	"confidence_level" "confidence_level",
	"uncertainty_flags" jsonb,
	"blocking_conditions" jsonb,
	"required_documents" jsonb,
	"missing_data_fields" jsonb,
	"sentence_snapshot_id" uuid,
	"source_analysis_id" uuid,
	"source_event_id" uuid,
	"playbook_version_id" uuid,
	"explanation_bundle_id" uuid,
	"legal_basis" text,
	"realized_piece_draft_id" uuid,
	"dismissed_at" timestamp with time zone,
	"dismissed_by_user_id" uuid,
	"dismissed_reason" text,
	"expired_at" timestamp with time zone,
	"requires_review" boolean DEFAULT true NOT NULL,
	"is_pending_review" boolean DEFAULT false NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"review_action" "opportunity_review_action" NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"explanation" text NOT NULL,
	"rejection_reason_code" text,
	"deferred_until" timestamp with time zone,
	"escalated_to_user_id" uuid,
	"opportunity_status_at_review" "opportunity_status" NOT NULL,
	"confidence_level_at_review" "confidence_level",
	"data_snapshot_ref" jsonb,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"previous_status" "opportunity_status" NOT NULL,
	"new_status" "opportunity_status" NOT NULL,
	"changed_by_actor_type" text NOT NULL,
	"changed_by_actor_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"review_id" uuid,
	"causing_event_id" uuid,
	"correlation_id" uuid NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "org_playbook_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"strategy_profile" "strategy_profile" DEFAULT 'standard' NOT NULL,
	"default_branches" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"last_updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_playbook_configs_org_family_uniq" UNIQUE("organization_id","family_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "playbook_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"jurisdiction_scope" text NOT NULL,
	"is_overlay" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_families_slug_org_uniq" UNIQUE("slug","organization_id")
);
--> statement-breakpoint
CREATE TABLE "playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"organization_id" uuid,
	"version_label" text NOT NULL,
	"status" "playbook_status" DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"supersedes_version_id" uuid,
	"rule_groups" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"legal_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_versions_family_label_uniq" UNIQUE("family_id","version_label")
);
--> statement-breakpoint
CREATE TABLE "prison_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"state_code" text,
	"city" text,
	"regime_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"administrative_authority" text,
	"cnpj" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"assignment_type" text NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"acted_by_user_id" uuid,
	"reason" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"causing_event_id" uuid,
	"correlation_id" uuid NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "queue_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"trigger" "escalation_trigger" NOT NULL,
	"previous_level" integer NOT NULL,
	"new_level" integer NOT NULL,
	"notified_users" jsonb,
	"escalation_reason" text,
	"breached_at" timestamp with time zone,
	"sla_breach" jsonb,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text NOT NULL,
	"escalated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"causing_event_id" uuid,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"queue_type" "queue_type" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"execution_case_id" uuid,
	"status" "queue_projection_status" DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"assignee_user_id" uuid,
	"responsible_lawyer_user_id" uuid,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"last_escalation_at" timestamp with time zone,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocking_reason" text,
	"is_stale" boolean DEFAULT false NOT NULL,
	"sla_deadline_at" timestamp with time zone,
	"sla_breached_at" timestamp with time zone,
	"snooze_until" timestamp with time zone,
	"deferred_until" timestamp with time zone,
	"snoozed_by_user_id" uuid,
	"display_title" text DEFAULT '' NOT NULL,
	"display_label" text,
	"key_date" timestamp with time zone,
	"metadata" jsonb,
	"source_causing_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_proj_entity_unique" UNIQUE("organization_id","queue_type","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "recalculation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"trigger_entity_type" text NOT NULL,
	"trigger_entity_id" uuid NOT NULL,
	"trigger_reason" text NOT NULL,
	"parent_recalculation_run_id" uuid,
	"chain_depth" integer DEFAULT 0 NOT NULL,
	"status" "recalculation_run_status" DEFAULT 'scheduled' NOT NULL,
	"produced_engine_run_id" uuid,
	"superseded_engine_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"material_change_detected" jsonb DEFAULT 'false'::jsonb NOT NULL,
	"change_summary" jsonb,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_details" text,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" "review_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"document_id" uuid,
	"snapshot_kind" text,
	"reviewer_user_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"decision" "review_decision" NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sentence_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "snapshot_status" DEFAULT 'proposed' NOT NULL,
	"total_sentence_days" integer NOT NULL,
	"served_days" integer DEFAULT 0 NOT NULL,
	"remission_days" integer DEFAULT 0 NOT NULL,
	"detraction_days" integer DEFAULT 0 NOT NULL,
	"remaining_days" integer NOT NULL,
	"percent_served" numeric(5, 4) NOT NULL,
	"crimes_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_generic_recidivist" boolean DEFAULT false NOT NULL,
	"confidence_level" "confidence_level" DEFAULT 'unknown' NOT NULL,
	"calculation_method" text,
	"playbook_version_id" uuid,
	"engine_run_id" uuid,
	"source_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"explanation" jsonb,
	"missing_data_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amends_snapshot_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"engine_run_id" uuid NOT NULL,
	"dependency_type" "snapshot_dependency_type" NOT NULL,
	"dependency_entity_id" uuid NOT NULL,
	"dependency_effective_at" timestamp with time zone,
	"dependency_version" text,
	"is_stale" boolean DEFAULT false NOT NULL,
	"staled_at" timestamp with time zone,
	"stale_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"snapshot_kind" text NOT NULL,
	"snapshot_id" uuid,
	"status" "snapshot_promotion_status" DEFAULT 'requested' NOT NULL,
	"extraction_type" text NOT NULL,
	"promoted_by_user_id" uuid,
	"promoted_at" timestamp with time zone,
	"trigger_event_id" uuid,
	"correlation_id" uuid,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_case_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_category" timeline_event_category NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" timeline_event_source NOT NULL,
	"source_ref_type" text,
	"source_ref_id" uuid,
	"author_user_id" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"actor_id" text NOT NULL,
	"visibility" timeline_visibility DEFAULT 'both' NOT NULL,
	"ai_confidence" numeric(5, 4),
	"ai_model_id" text,
	"amends_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"bar_number" text,
	"phone" text,
	"avatar_url" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflow_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_type" "workflow_task_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "workflow_task_status" DEFAULT 'pending' NOT NULL,
	"priority" "deadline_priority" DEFAULT 'normal' NOT NULL,
	"execution_case_id" uuid,
	"source_entity_type" text,
	"source_entity_id" uuid,
	"causing_event_id" uuid,
	"linked_deadline_id" uuid,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"assigned_to_user_id" uuid,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocking_reason" text,
	"blocking_conditions" jsonb,
	"requires_review" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"completion_evidence_type" text,
	"completion_evidence_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"escalated_at" timestamp with time zone,
	"escalated_to_user_id" uuid,
	"escalation_reason" text,
	"parent_task_id" uuid,
	"task_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ba_account" ADD CONSTRAINT "ba_account_user_id_ba_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ba_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ba_session" ADD CONSTRAINT "ba_session_user_id_ba_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ba_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_playbook_contexts" ADD CONSTRAINT "case_playbook_contexts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_playbook_contexts" ADD CONSTRAINT "case_playbook_contexts_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_playbook_contexts" ADD CONSTRAINT "case_playbook_contexts_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_playbook_contexts" ADD CONSTRAINT "case_playbook_contexts_superseded_by_context_id_case_playbook_contexts_id_fk" FOREIGN KEY ("superseded_by_context_id") REFERENCES "public"."case_playbook_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_responsible_lawyer_user_id_users_id_fk" FOREIGN KEY ("responsible_lawyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merged_into_client_id_clients_id_fk" FOREIGN KEY ("merged_into_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_custody_snapshots" ADD CONSTRAINT "execution_custody_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_custody_snapshots" ADD CONSTRAINT "execution_custody_snapshots_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_custody_snapshots" ADD CONSTRAINT "execution_custody_snapshots_prison_unit_id_prison_units_id_fk" FOREIGN KEY ("prison_unit_id") REFERENCES "public"."prison_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_custody_snapshots" ADD CONSTRAINT "execution_custody_snapshots_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_custody_snapshots" ADD CONSTRAINT "execution_custody_snapshots_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_custody_snapshots" ADD CONSTRAINT "execution_custody_snapshots_superseded_by_snapshot_id_execution_custody_snapshots_id_fk" FOREIGN KEY ("superseded_by_snapshot_id") REFERENCES "public"."execution_custody_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_custody_snapshots" ADD CONSTRAINT "execution_custody_snapshots_amends_snapshot_id_execution_custody_snapshots_id_fk" FOREIGN KEY ("amends_snapshot_id") REFERENCES "public"."execution_custody_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_history" ADD CONSTRAINT "deadline_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_history" ADD CONSTRAINT "deadline_history_deadline_id_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_history" ADD CONSTRAINT "deadline_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_parent_deadline_id_deadlines_id_fk" FOREIGN KEY ("parent_deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_dismissed_by_user_id_users_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extraction_results" ADD CONSTRAINT "document_extraction_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extraction_results" ADD CONSTRAINT "document_extraction_results_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extraction_results" ADD CONSTRAINT "document_extraction_results_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ocr_results" ADD CONSTRAINT "document_ocr_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ocr_results" ADD CONSTRAINT "document_ocr_results_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ocr_results" ADD CONSTRAINT "document_ocr_results_ocr_run_id_ocr_runs_id_fk" FOREIGN KEY ("ocr_run_id") REFERENCES "public"."ocr_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_intake_bundle_id_intake_bundles_id_fk" FOREIGN KEY ("intake_bundle_id") REFERENCES "public"."intake_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_supersedes_document_id_documents_id_fk" FOREIGN KEY ("supersedes_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_rule_traces" ADD CONSTRAINT "engine_rule_traces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_rule_traces" ADD CONSTRAINT "engine_rule_traces_engine_run_id_engine_runs_id_fk" FOREIGN KEY ("engine_run_id") REFERENCES "public"."engine_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_playbook_version_id_playbook_versions_id_fk" FOREIGN KEY ("playbook_version_id") REFERENCES "public"."playbook_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_overlay_version_id_playbook_versions_id_fk" FOREIGN KEY ("overlay_version_id") REFERENCES "public"."playbook_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_cases" ADD CONSTRAINT "execution_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_cases" ADD CONSTRAINT "execution_cases_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_cases" ADD CONSTRAINT "execution_cases_parent_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("parent_execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_cases" ADD CONSTRAINT "execution_cases_responsible_lawyer_user_id_users_id_fk" FOREIGN KEY ("responsible_lawyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_cases" ADD CONSTRAINT "execution_cases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanation_bundles" ADD CONSTRAINT "explanation_bundles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanation_bundles" ADD CONSTRAINT "explanation_bundles_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanation_bundles" ADD CONSTRAINT "explanation_bundles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_ocr_run_id_ocr_runs_id_fk" FOREIGN KEY ("ocr_run_id") REFERENCES "public"."ocr_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_ocr_result_id_document_ocr_results_id_fk" FOREIGN KEY ("ocr_result_id") REFERENCES "public"."document_ocr_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bundles" ADD CONSTRAINT "intake_bundles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bundles" ADD CONSTRAINT "intake_bundles_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bundles" ADD CONSTRAINT "intake_bundles_proposed_client_id_clients_id_fk" FOREIGN KEY ("proposed_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bundles" ADD CONSTRAINT "intake_bundles_proposed_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("proposed_execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bundles" ADD CONSTRAINT "intake_bundles_associated_client_id_clients_id_fk" FOREIGN KEY ("associated_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bundles" ADD CONSTRAINT "intake_bundles_associated_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("associated_execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bundles" ADD CONSTRAINT "intake_bundles_associated_by_user_id_users_id_fk" FOREIGN KEY ("associated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_runs" ADD CONSTRAINT "ocr_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_runs" ADD CONSTRAINT "ocr_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_qualified_by_user_id_users_id_fk" FOREIGN KEY ("qualified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_explanation_bundle_id_explanation_bundles_id_fk" FOREIGN KEY ("explanation_bundle_id") REFERENCES "public"."explanation_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_dismissed_by_user_id_users_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_escalated_to_user_id_users_id_fk" FOREIGN KEY ("escalated_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_status_history" ADD CONSTRAINT "opportunity_status_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_status_history" ADD CONSTRAINT "opportunity_status_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_playbook_configs" ADD CONSTRAINT "org_playbook_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_playbook_configs" ADD CONSTRAINT "org_playbook_configs_family_id_playbook_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."playbook_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_playbook_configs" ADD CONSTRAINT "org_playbook_configs_last_updated_by_user_id_users_id_fk" FOREIGN KEY ("last_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_families" ADD CONSTRAINT "playbook_families_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_family_id_playbook_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."playbook_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_supersedes_version_id_playbook_versions_id_fk" FOREIGN KEY ("supersedes_version_id") REFERENCES "public"."playbook_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prison_units" ADD CONSTRAINT "prison_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_assignments" ADD CONSTRAINT "queue_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_escalations" ADD CONSTRAINT "queue_escalations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_projections" ADD CONSTRAINT "queue_projections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalculation_runs" ADD CONSTRAINT "recalculation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalculation_runs" ADD CONSTRAINT "recalculation_runs_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalculation_runs" ADD CONSTRAINT "recalculation_runs_produced_engine_run_id_engine_runs_id_fk" FOREIGN KEY ("produced_engine_run_id") REFERENCES "public"."engine_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentence_snapshots" ADD CONSTRAINT "sentence_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentence_snapshots" ADD CONSTRAINT "sentence_snapshots_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentence_snapshots" ADD CONSTRAINT "sentence_snapshots_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentence_snapshots" ADD CONSTRAINT "sentence_snapshots_amends_snapshot_id_sentence_snapshots_id_fk" FOREIGN KEY ("amends_snapshot_id") REFERENCES "public"."sentence_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentence_snapshots" ADD CONSTRAINT "sentence_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_dependencies" ADD CONSTRAINT "snapshot_dependencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_dependencies" ADD CONSTRAINT "snapshot_dependencies_engine_run_id_engine_runs_id_fk" FOREIGN KEY ("engine_run_id") REFERENCES "public"."engine_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_promotions" ADD CONSTRAINT "snapshot_promotions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_promotions" ADD CONSTRAINT "snapshot_promotions_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_promotions" ADD CONSTRAINT "snapshot_promotions_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_promotions" ADD CONSTRAINT "snapshot_promotions_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_promotions" ADD CONSTRAINT "snapshot_promotions_promoted_by_user_id_users_id_fk" FOREIGN KEY ("promoted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_amends_event_id_timeline_events_id_fk" FOREIGN KEY ("amends_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_execution_case_id_execution_cases_id_fk" FOREIGN KEY ("execution_case_id") REFERENCES "public"."execution_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_escalated_to_user_id_users_id_fk" FOREIGN KEY ("escalated_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_parent_task_id_workflow_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_occurred_idx" ON "audit_logs" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_type","actor_id","organization_id");--> statement-breakpoint
CREATE INDEX "ba_account_user_idx" ON "ba_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ba_account_provider_idx" ON "ba_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "ba_session_user_idx" ON "ba_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ba_session_expires_idx" ON "ba_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ba_user_email_idx" ON "ba_user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ba_verification_identifier_idx" ON "ba_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "ba_verification_expires_idx" ON "ba_verification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "case_playbook_contexts_case_idx" ON "case_playbook_contexts" USING btree ("execution_case_id","created_at");--> statement-breakpoint
CREATE INDEX "case_playbook_contexts_org_idx" ON "case_playbook_contexts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_cpf_unique" ON "clients" USING btree ("organization_id","cpf");--> statement-breakpoint
CREATE INDEX "clients_org_status_idx" ON "clients" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "clients_lawyer_idx" ON "clients" USING btree ("organization_id","responsible_lawyer_user_id");--> statement-breakpoint
CREATE INDEX "clients_internal_ref_idx" ON "clients" USING btree ("organization_id","internal_ref");--> statement-breakpoint
CREATE INDEX "custody_snapshots_case_effective_idx" ON "execution_custody_snapshots" USING btree ("execution_case_id","effective_at");--> statement-breakpoint
CREATE INDEX "custody_snapshots_unconfirmed_idx" ON "execution_custody_snapshots" USING btree ("organization_id","confirmed_by_user_id");--> statement-breakpoint
CREATE INDEX "custody_snapshots_org_idx" ON "execution_custody_snapshots" USING btree ("organization_id","recorded_at");--> statement-breakpoint
CREATE INDEX "deadline_history_deadline_idx" ON "deadline_history" USING btree ("deadline_id","changed_at");--> statement-breakpoint
CREATE INDEX "deadline_history_org_idx" ON "deadline_history" USING btree ("organization_id","changed_at");--> statement-breakpoint
CREATE INDEX "deadlines_org_status_due_idx" ON "deadlines" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "deadlines_case_idx" ON "deadlines" USING btree ("execution_case_id","status","due_at");--> statement-breakpoint
CREATE INDEX "deadlines_assignee_idx" ON "deadlines" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "deadlines_escalation_idx" ON "deadlines" USING btree ("organization_id","escalation_level","status");--> statement-breakpoint
CREATE INDEX "deadlines_blocked_idx" ON "deadlines" USING btree ("organization_id","is_blocked");--> statement-breakpoint
CREATE INDEX "deadlines_priority_idx" ON "deadlines" USING btree ("organization_id","priority","status");--> statement-breakpoint
CREATE UNIQUE INDEX "document_extraction_results_run_unique" ON "document_extraction_results" USING btree ("extraction_run_id");--> statement-breakpoint
CREATE INDEX "document_extraction_results_document_idx" ON "document_extraction_results" USING btree ("document_id","extracted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_ocr_results_run_unique" ON "document_ocr_results" USING btree ("ocr_run_id");--> statement-breakpoint
CREATE INDEX "document_ocr_results_document_idx" ON "document_ocr_results" USING btree ("document_id","extracted_at");--> statement-breakpoint
CREATE INDEX "documents_ocr_queue_idx" ON "documents" USING btree ("organization_id","ocr_status");--> statement-breakpoint
CREATE INDEX "documents_case_status_idx" ON "documents" USING btree ("execution_case_id","status");--> statement-breakpoint
CREATE INDEX "documents_bundle_idx" ON "documents" USING btree ("intake_bundle_id");--> statement-breakpoint
CREATE INDEX "documents_checksum_idx" ON "documents" USING btree ("checksum_sha256");--> statement-breakpoint
CREATE INDEX "documents_client_idx" ON "documents" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "documents_org_status_idx" ON "documents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "domain_events_outbox_idx" ON "domain_events" USING btree ("processing_status","recorded_at");--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_idx" ON "domain_events" USING btree ("aggregate_type","aggregate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_org_occurred_idx" ON "domain_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_causation_idx" ON "domain_events" USING btree ("causation_id");--> statement-breakpoint
CREATE INDEX "domain_events_correlation_idx" ON "domain_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "engine_rule_traces_run_order_idx" ON "engine_rule_traces" USING btree ("engine_run_id","evaluation_order");--> statement-breakpoint
CREATE INDEX "engine_rule_traces_rule_idx" ON "engine_rule_traces" USING btree ("rule_id","playbook_version_id");--> statement-breakpoint
CREATE INDEX "engine_rule_traces_org_idx" ON "engine_rule_traces" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "engine_runs_case_idx" ON "engine_runs" USING btree ("execution_case_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "engine_runs_org_status_idx" ON "engine_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "engine_runs_playbook_idx" ON "engine_runs" USING btree ("playbook_version_id");--> statement-breakpoint
CREATE INDEX "engine_runs_correlation_idx" ON "engine_runs" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_cases_process_number_unique" ON "execution_cases" USING btree ("organization_id","execution_process_number");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_cases_internal_ref_unique" ON "execution_cases" USING btree ("organization_id","internal_ref");--> statement-breakpoint
CREATE INDEX "execution_cases_org_status_idx" ON "execution_cases" USING btree ("organization_id","case_status");--> statement-breakpoint
CREATE INDEX "execution_cases_client_idx" ON "execution_cases" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "execution_cases_lawyer_idx" ON "execution_cases" USING btree ("organization_id","responsible_lawyer_user_id","case_status");--> statement-breakpoint
CREATE INDEX "explanation_bundles_case_idx" ON "explanation_bundles" USING btree ("execution_case_id");--> statement-breakpoint
CREATE INDEX "explanation_bundles_engine_run_idx" ON "explanation_bundles" USING btree ("engine_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_runs_document_run_number_unique" ON "extraction_runs" USING btree ("document_id","run_number");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_runs_trigger_idempotency_idx" ON "extraction_runs" USING btree ("document_id","trigger_event_id") WHERE "extraction_runs"."trigger_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "extraction_runs_status_queue_idx" ON "extraction_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "intake_bundles_org_status_idx" ON "intake_bundles" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "intake_bundles_uploader_idx" ON "intake_bundles" USING btree ("organization_id","uploader_user_id");--> statement-breakpoint
CREATE INDEX "intake_bundles_client_idx" ON "intake_bundles" USING btree ("associated_client_id");--> statement-breakpoint
CREATE INDEX "intake_bundles_case_idx" ON "intake_bundles" USING btree ("associated_execution_case_id");--> statement-breakpoint
CREATE INDEX "intake_bundles_received_idx" ON "intake_bundles" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_unique" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_runs_document_run_number_unique" ON "ocr_runs" USING btree ("document_id","run_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_runs_trigger_idempotency_idx" ON "ocr_runs" USING btree ("document_id","trigger_event_id") WHERE "ocr_runs"."trigger_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ocr_runs_status_queue_idx" ON "ocr_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "opportunities_org_status_idx" ON "opportunities" USING btree ("organization_id","status","detected_at");--> statement-breakpoint
CREATE INDEX "opportunities_case_idx" ON "opportunities" USING btree ("execution_case_id","status");--> statement-breakpoint
CREATE INDEX "opportunities_type_status_idx" ON "opportunities" USING btree ("organization_id","opportunity_type","status");--> statement-breakpoint
CREATE INDEX "opportunities_pending_review_idx" ON "opportunities" USING btree ("organization_id","is_pending_review","status");--> statement-breakpoint
CREATE INDEX "opportunities_window_idx" ON "opportunities" USING btree ("organization_id","window_end_at","status");--> statement-breakpoint
CREATE INDEX "opportunities_blocked_idx" ON "opportunities" USING btree ("organization_id","is_blocked");--> statement-breakpoint
CREATE INDEX "opportunity_reviews_opp_idx" ON "opportunity_reviews" USING btree ("opportunity_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "opportunity_reviews_reviewer_idx" ON "opportunity_reviews" USING btree ("organization_id","reviewer_user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "opportunity_reviews_action_idx" ON "opportunity_reviews" USING btree ("organization_id","review_action","reviewed_at");--> statement-breakpoint
CREATE INDEX "opp_status_history_opp_idx" ON "opportunity_status_history" USING btree ("opportunity_id","changed_at");--> statement-breakpoint
CREATE INDEX "opp_status_history_org_idx" ON "opportunity_status_history" USING btree ("organization_id","changed_at");--> statement-breakpoint
CREATE INDEX "opp_status_history_new_status_idx" ON "opportunity_status_history" USING btree ("organization_id","new_status","changed_at");--> statement-breakpoint
CREATE INDEX "org_playbook_configs_org_idx" ON "org_playbook_configs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "playbook_families_org_idx" ON "playbook_families" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "playbook_families_jurisdiction_idx" ON "playbook_families" USING btree ("jurisdiction_scope");--> statement-breakpoint
CREATE INDEX "playbook_versions_family_status_idx" ON "playbook_versions" USING btree ("family_id","status");--> statement-breakpoint
CREATE INDEX "playbook_versions_org_status_idx" ON "playbook_versions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "playbook_versions_effective_idx" ON "playbook_versions" USING btree ("family_id","effective_from","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "prison_units_code_org_unique" ON "prison_units" USING btree ("code","organization_id");--> statement-breakpoint
CREATE INDEX "prison_units_state_idx" ON "prison_units" USING btree ("state_code","active");--> statement-breakpoint
CREATE INDEX "prison_units_org_idx" ON "prison_units" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "queue_assignments_entity_idx" ON "queue_assignments" USING btree ("target_entity_type","target_entity_id","assigned_at");--> statement-breakpoint
CREATE INDEX "queue_assignments_user_idx" ON "queue_assignments" USING btree ("organization_id","to_user_id","assigned_at");--> statement-breakpoint
CREATE INDEX "queue_escalations_entity_idx" ON "queue_escalations" USING btree ("target_entity_type","target_entity_id","escalated_at");--> statement-breakpoint
CREATE INDEX "queue_escalations_org_idx" ON "queue_escalations" USING btree ("organization_id","escalated_at");--> statement-breakpoint
CREATE INDEX "queue_escalations_trigger_idx" ON "queue_escalations" USING btree ("organization_id","trigger","escalated_at");--> statement-breakpoint
CREATE INDEX "queue_proj_org_queue_priority_idx" ON "queue_projections" USING btree ("organization_id","queue_type","status","priority","key_date");--> statement-breakpoint
CREATE INDEX "queue_proj_assignee_idx" ON "queue_projections" USING btree ("assignee_user_id","status","priority");--> statement-breakpoint
CREATE INDEX "queue_proj_lawyer_idx" ON "queue_projections" USING btree ("responsible_lawyer_user_id","status","priority");--> statement-breakpoint
CREATE INDEX "queue_proj_sla_idx" ON "queue_projections" USING btree ("organization_id","sla_deadline_at","sla_breached_at","status");--> statement-breakpoint
CREATE INDEX "queue_proj_escalation_idx" ON "queue_projections" USING btree ("organization_id","escalation_level","priority","status");--> statement-breakpoint
CREATE INDEX "queue_proj_snooze_idx" ON "queue_projections" USING btree ("organization_id","status","snooze_until");--> statement-breakpoint
CREATE INDEX "queue_proj_entity_idx" ON "queue_projections" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "recalculation_runs_case_idx" ON "recalculation_runs" USING btree ("execution_case_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "recalculation_runs_org_status_idx" ON "recalculation_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "recalculation_runs_trigger_idx" ON "recalculation_runs" USING btree ("trigger_entity_type","trigger_entity_id");--> statement-breakpoint
CREATE INDEX "recalculation_runs_parent_idx" ON "recalculation_runs" USING btree ("parent_recalculation_run_id");--> statement-breakpoint
CREATE INDEX "review_decisions_subject_idx" ON "review_decisions" USING btree ("organization_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "review_decisions_reviewer_idx" ON "review_decisions" USING btree ("organization_id","reviewer_user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "sentence_snapshots_case_effective_idx" ON "sentence_snapshots" USING btree ("execution_case_id","effective_at");--> statement-breakpoint
CREATE INDEX "sentence_snapshots_status_idx" ON "sentence_snapshots" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "sentence_snapshots_replay_idx" ON "sentence_snapshots" USING btree ("execution_case_id","recorded_at","effective_at");--> statement-breakpoint
CREATE INDEX "sentence_snapshots_engine_run_idx" ON "sentence_snapshots" USING btree ("engine_run_id");--> statement-breakpoint
CREATE INDEX "snapshot_dependencies_run_idx" ON "snapshot_dependencies" USING btree ("engine_run_id");--> statement-breakpoint
CREATE INDEX "snapshot_dependencies_entity_idx" ON "snapshot_dependencies" USING btree ("dependency_type","dependency_entity_id");--> statement-breakpoint
CREATE INDEX "snapshot_dependencies_stale_idx" ON "snapshot_dependencies" USING btree ("organization_id","is_stale");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_promotions_extraction_run_unique" ON "snapshot_promotions" USING btree ("extraction_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_promotions_trigger_idempotency_idx" ON "snapshot_promotions" USING btree ("source_document_id","trigger_event_id") WHERE "snapshot_promotions"."trigger_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "snapshot_promotions_status_idx" ON "snapshot_promotions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "timeline_events_case_occurred_idx" ON "timeline_events" USING btree ("execution_case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "timeline_events_case_category_idx" ON "timeline_events" USING btree ("execution_case_id","event_category","occurred_at");--> statement-breakpoint
CREATE INDEX "timeline_events_replay_idx" ON "timeline_events" USING btree ("execution_case_id","recorded_at","occurred_at");--> statement-breakpoint
CREATE INDEX "timeline_events_org_recorded_idx" ON "timeline_events" USING btree ("organization_id","recorded_at");--> statement-breakpoint
CREATE INDEX "timeline_events_amends_idx" ON "timeline_events" USING btree ("amends_event_id");--> statement-breakpoint
CREATE INDEX "workflow_tasks_org_status_idx" ON "workflow_tasks" USING btree ("organization_id","status","priority","due_at");--> statement-breakpoint
CREATE INDEX "workflow_tasks_assignee_idx" ON "workflow_tasks" USING btree ("assigned_to_user_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_claimed_idx" ON "workflow_tasks" USING btree ("claimed_by_user_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_case_idx" ON "workflow_tasks" USING btree ("execution_case_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_source_idx" ON "workflow_tasks" USING btree ("source_entity_type","source_entity_id");--> statement-breakpoint
CREATE INDEX "workflow_tasks_due_idx" ON "workflow_tasks" USING btree ("organization_id","due_at","status");