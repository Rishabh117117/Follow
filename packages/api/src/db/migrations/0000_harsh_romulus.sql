CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."file_type" AS ENUM('file', 'folder', 'notebook');--> statement-breakpoint
CREATE TYPE "public"."annotation_type" AS ENUM('note', 'correction', 'bookmark', 'decision', 'milestone', 'question');--> statement-breakpoint
CREATE TYPE "public"."recording_session_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."timeline_resolution" AS ENUM('15sec', '5min', '15min', '30min', '1hr', '6hr', '12hr', '1day', '1week', '1month');--> statement-breakpoint
CREATE TYPE "public"."conversation_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."conversation_type" AS ENUM('standard', 'deep_dive', 'agent_initiated', 'capture_ask', 'group');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."capture_source" AS ENUM('bookmarklet', 'extension', 'api');--> statement-breakpoint
CREATE TYPE "public"."file_share_permission" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('mention', 'comment', 'share', 'invite', 'agent_complete', 'prompt_card', 'system', 'tension', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."nav_session_status" AS ENUM('pending', 'navigating', 'spotlighting', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."doc_suggestion_action" AS ENUM('accepted', 'rejected', 'regenerated', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'rejected', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."suggestion_type" AS ENUM('clarity', 'conciseness', 'tone', 'grammar', 'structure', 'custom');--> statement-breakpoint
CREATE TYPE "public"."cross_ref_type" AS ENUM('led_to', 'influenced_by', 'applied_to', 'related_to', 'triggered_by');--> statement-breakpoint
CREATE TYPE "public"."thread_event_magnitude" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."thread_event_type" AS ENUM('edit', 'navigation', 'ai_interaction', 'structural_change', 'reference', 'gap', 'import', 'session_start', 'session_end');--> statement-breakpoint
CREATE TYPE "public"."reference_by_type" AS ENUM('chat', 'strand', 'thread');--> statement-breakpoint
CREATE TYPE "public"."strand_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."thread_session_status" AS ENUM('active', 'distilling', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."thread_type" AS ENUM('user', 'ai', 'doc', 'browser', 'import');--> statement-breakpoint
CREATE TYPE "public"."cognitive_state" AS ENUM('exploring', 'comparing', 'deciding', 'synthesizing', 'refining', 'stuck', 'presenting');--> statement-breakpoint
CREATE TYPE "public"."narrative_phase" AS ENUM('inception', 'exploration', 'convergence', 'stabilization', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."external_doc_type" AS ENUM('google_docs', 'google_sheets', 'google_slides');--> statement-breakpoint
CREATE TYPE "public"."notebook_block_type" AS ENUM('text', 'freehand', 'shape', 'image', 'audio', 'video', 'sticky', 'connector', 'embed', 'comment');--> statement-breakpoint
CREATE TYPE "public"."page_background" AS ENUM('blank', 'ruled', 'dotted', 'grid', 'cornell');--> statement-breakpoint
CREATE TYPE "public"."page_size" AS ENUM('letter', 'a4', 'a5', 'custom');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expertise_areas" jsonb DEFAULT '{}'::jsonb,
	"prompt_preferences" jsonb DEFAULT '{}'::jsonb,
	"interaction_style" jsonb DEFAULT '{}'::jsonb,
	"known_facts" jsonb DEFAULT '[]'::jsonb,
	"total_prompts_shown" integer DEFAULT 0 NOT NULL,
	"total_prompts_answered" integer DEFAULT 0 NOT NULL,
	"total_prompts_dismissed" integer DEFAULT 0 NOT NULL,
	"automation_preferences" jsonb DEFAULT '{}'::jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"image" text,
	"email_verified" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"invite_email" text,
	"invite_token" text,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"storage_path" text NOT NULL,
	"size_bytes" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"diff_summary" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"space_id" uuid,
	"parent_folder_id" uuid,
	"name" text NOT NULL,
	"type" "file_type" NOT NULL,
	"mime_type" text,
	"storage_path" text,
	"size_bytes" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recording_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"status" "recording_session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"event_count" integer DEFAULT 0,
	"summary_text" text,
	"topics" text[],
	"intent" text,
	"metrics" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timeline_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"agent_run_id" uuid,
	"target_timestamp" timestamp with time zone NOT NULL,
	"target_event_id" uuid,
	"target_summary_id" uuid,
	"annotation_type" "annotation_type" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"is_resolved" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"action_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"session_id" text,
	"agent_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timeline_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"resolution" timeline_resolution NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"summary_text" text NOT NULL,
	"topics" text[],
	"intent" text,
	"key_objects" uuid[],
	"metrics" jsonb DEFAULT '{}'::jsonb,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"summary" text,
	"topics" text[],
	"entities" jsonb,
	"importance" real DEFAULT 0.5,
	"content_hash" text,
	"last_agent_run_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"content" jsonb NOT NULL,
	"source_summaries" uuid[],
	"source_agent_runs" uuid[],
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"access_scope" text DEFAULT 'workspace' NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "conversation_member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_conversation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"messages_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"type" "conversation_type" DEFAULT 'standard' NOT NULL,
	"parent_conversation_id" uuid,
	"context_object_id" uuid,
	"context_object_type" text,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"chat_source_type" text DEFAULT 'follow-web',
	"content_hash" text,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid,
	"role" "message_role" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"rich_content" jsonb,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"parent_message_id" uuid,
	"superseded_by_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deep_dive_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"permissions" text[] DEFAULT '{"{read}"}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"content" text NOT NULL,
	"position" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_views" (
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_views_file_id_user_id_pk" PRIMARY KEY("file_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid,
	"permission" "file_share_permission" DEFAULT 'viewer' NOT NULL,
	"shared_by" uuid NOT NULL,
	"share_token" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "web_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"screenshot" text,
	"source" "capture_source" DEFAULT 'bookmarklet' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"file_id" uuid,
	"analyzed" boolean DEFAULT false NOT NULL,
	"analysis_result" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "space_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"external_document_id" uuid,
	"file_id" uuid,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_docs_ext_unique" UNIQUE("space_id","external_document_id"),
	CONSTRAINT "space_docs_file_unique" UNIQUE("space_id","file_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"canvas_file_id" uuid,
	"icon" text,
	"color" text,
	"is_project" boolean DEFAULT false NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL,
	"discoverable_at" timestamp with time zone,
	"discoverable_scope" text DEFAULT 'workspace',
	"strand_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browser_nav_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"target_description" text,
	"final_url" text,
	"status" "nav_session_status" DEFAULT 'pending' NOT NULL,
	"confidence" real,
	"screenshot_data_url" text,
	"spotlight_fired" integer DEFAULT 0 NOT NULL,
	"fallback_used" text,
	"error_reason" text,
	"nav_intent" jsonb DEFAULT '{}'::jsonb,
	"ranked_results" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_suggestion_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "doc_suggestion_action" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"suggestion_type" "suggestion_type" NOT NULL,
	"span_text" text NOT NULL,
	"original_text" text NOT NULL,
	"explanation" text,
	"variants" jsonb DEFAULT '[]'::jsonb,
	"confidence" real DEFAULT 0.7 NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"accepted_variant" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"referenced_by_type" "reference_by_type" NOT NULL,
	"referenced_by_id" uuid NOT NULL,
	"context" text,
	"time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strand_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strand_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"can_see_user_thread" boolean DEFAULT false NOT NULL,
	"can_see_ai_thread" boolean DEFAULT true NOT NULL,
	"can_see_doc_threads" boolean DEFAULT true NOT NULL,
	"can_see_browser_thread" boolean DEFAULT false NOT NULL,
	"invited_by" uuid NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strand_collab_unique" UNIQUE("strand_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strand_thread_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strand_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" uuid NOT NULL,
	"visible_to_collaborators" boolean DEFAULT true NOT NULL,
	"relevance_weight" real DEFAULT 1 NOT NULL,
	CONSTRAINT "str_refs_unique" UNIQUE("strand_id","thread_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#7C6EF7' NOT NULL,
	"status" "strand_status" DEFAULT 'active' NOT NULL,
	"summary_text" text,
	"founding_context" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"strand_instructions" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"session_id" uuid,
	"time" timestamp with time zone DEFAULT now() NOT NULL,
	"label" text NOT NULL,
	"type" "thread_event_type" NOT NULL,
	"magnitude" "thread_event_magnitude" DEFAULT 'low' NOT NULL,
	"distilled_from" text[] DEFAULT '{}',
	"context_notes" text,
	"key_change" boolean DEFAULT false NOT NULL,
	"migrated_from_timeline" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"recording_session_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" "thread_session_status" DEFAULT 'active' NOT NULL,
	"raw_signal_count" integer DEFAULT 0 NOT NULL,
	"distilled_event_count" integer DEFAULT 0 NOT NULL,
	"last_processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" "thread_type" NOT NULL,
	"name" text NOT NULL,
	"status" "thread_status" DEFAULT 'active' NOT NULL,
	"home_strand_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_decision_trails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"paragraph_ref" text NOT NULL,
	"trail_steps" jsonb DEFAULT '[]'::jsonb,
	"stability_score" real DEFAULT 0 NOT NULL,
	"human_authored_pct" real DEFAULT 1 NOT NULL,
	"anchor_source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_interpretations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"strand_id" uuid,
	"narrative_phase" "narrative_phase" NOT NULL,
	"narrative_confidence" real NOT NULL,
	"narrative_summary" text NOT NULL,
	"working_intent" text NOT NULL,
	"intent_evidence" text NOT NULL,
	"cognitive_state" "cognitive_state" NOT NULL,
	"active_tensions" jsonb DEFAULT '[]'::jsonb,
	"source_influence" jsonb DEFAULT '[]'::jsonb,
	"unresolved_questions" jsonb DEFAULT '[]'::jsonb,
	"model_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"confidence" real NOT NULL,
	"evidence" text[] DEFAULT '{}',
	"reinforced_count" integer DEFAULT 1 NOT NULL,
	"dismissed" jsonb DEFAULT 'false'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reinforced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_trackers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'collaborator' NOT NULL,
	"doc_thread_id" uuid,
	"ai_thread_id" uuid,
	"browser_thread_id" uuid,
	"user_thread_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "doc_trackers_unique" UNIQUE("external_document_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"external_doc_id" text NOT NULL,
	"doc_type" "external_doc_type" NOT NULL,
	"title" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"strand_id" uuid,
	"last_sync_revision" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ext_doc_active_unique" UNIQUE("external_doc_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"title" text,
	"status" text DEFAULT 'open' NOT NULL,
	"summary_text" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"record_count" integer DEFAULT 0 NOT NULL,
	"merged_into_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"index_record_id" uuid,
	"document_id" uuid,
	"user_id" uuid,
	"section_ref" text,
	"evidence_type" text NOT NULL,
	"content_before" text,
	"content_after" text,
	"chat_exchange" jsonb,
	"source_snapshot" jsonb,
	"hash_chain_prev" text,
	"record_hash" text NOT NULL,
	"ownership_tier" text DEFAULT 'document' NOT NULL,
	"retention_policy" text,
	"redacted_at" timestamp with time zone,
	"redacted_fields" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gws_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"external_doc_id" varchar(255) NOT NULL,
	"doc_type" varchar(32) NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"previous_hash" varchar(64),
	"diff_summary" text,
	"trigger_type" varchar(32) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "index_record_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"index_record_id" uuid NOT NULL,
	"state_type" varchar(16) NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"engagement_depth" real,
	"is_key_change" boolean,
	"has_evidence" boolean,
	"document_id" varchar(255),
	"document_title" text,
	"section_alias" text,
	"embedding_text" text,
	"metadata" jsonb,
	"source_file_id" varchar(255),
	"source_version" integer,
	"source_content_hash" varchar(64),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" varchar(64),
	"capture_reason" text,
	"superseded_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" varchar(32)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "index_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"thread_event_id" uuid NOT NULL,
	"thread_type" text NOT NULL,
	"embedding" vector(1536),
	"embedding_text" text NOT NULL,
	"index_magnitude" text DEFAULT 'small' NOT NULL,
	"is_key_change" boolean DEFAULT false NOT NULL,
	"is_ai_involved" boolean DEFAULT false NOT NULL,
	"has_evidence" boolean DEFAULT false NOT NULL,
	"engagement_depth" real DEFAULT 0 NOT NULL,
	"episode_id" uuid,
	"document_id" uuid,
	"document_title" text,
	"section_alias" text,
	"user_id" uuid NOT NULL,
	"user_name" text,
	"event_time" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"embedding_content" vector(768),
	"embedding_causal" vector(512),
	"embedding_context" vector(512),
	"source_file_id" varchar(255),
	"source_version" integer,
	"source_content_hash" varchar(64),
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp with time zone,
	"editor_confidence" real,
	"editor_importance" real,
	"editor_salience" real,
	"editor_freshness" varchar(16),
	"editor_run_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" varchar(32),
	"deletion_scope" varchar(16)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "section_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"old_heading" text NOT NULL,
	"new_heading" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "semantic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"target_record_id" uuid NOT NULL,
	"similarity" real NOT NULL,
	"link_type" text NOT NULL,
	"cross_user" boolean DEFAULT false NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" varchar(32)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notebook_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"notebook_id" uuid NOT NULL,
	"type" "notebook_block_type" NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"rotation" integer DEFAULT 0,
	"z_index" integer DEFAULT 0 NOT NULL,
	"locked" boolean DEFAULT false,
	"data" jsonb NOT NULL,
	"created_by" uuid,
	"last_edited_by" uuid,
	"ai_generated" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notebook_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"background" "page_background" DEFAULT 'blank' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notebooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_size" "page_size" DEFAULT 'letter' NOT NULL,
	"custom_width" integer,
	"custom_height" integer,
	"page_count" integer DEFAULT 1 NOT NULL,
	"default_background" "page_background" DEFAULT 'blank' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"state_event" jsonb DEFAULT '{}' NOT NULL,
	"state_session" jsonb DEFAULT '{}' NOT NULL,
	"state_persistent" jsonb DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_event_update" timestamp with time zone,
	"last_condensation" timestamp with time zone,
	"last_pattern_detection" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_shared_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"state" jsonb DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "context_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"responder_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope_type" varchar(32) NOT NULL,
	"scope_ref_id" varchar(255),
	"query" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"urgency" varchar(16) DEFAULT 'normal',
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "index_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"passcode_hash" varchar(255),
	"passcode_salt" varchar(64),
	"session_token" varchar(255),
	"session_expires_at" timestamp with time zone,
	"is_locked" boolean DEFAULT true NOT NULL,
	"lock_policy" varchar(32) DEFAULT 'on_idle' NOT NULL,
	"active_preset" varchar(32) DEFAULT 'balanced' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_access_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "privacy_filter_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_name" varchar(128) NOT NULL,
	"rule_type" varchar(32) NOT NULL,
	"rule_config" jsonb NOT NULL,
	"scope" varchar(32) DEFAULT 'all' NOT NULL,
	"scope_document_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shared_slices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slice_content" text NOT NULL,
	"slice_metadata" jsonb NOT NULL,
	"scope_type" varchar(32) NOT NULL,
	"scope_ref_id" varchar(255),
	"preset_used" varchar(32) NOT NULL,
	"rules_applied" integer DEFAULT 0 NOT NULL,
	"redaction_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_version" integer DEFAULT 1 NOT NULL,
	"sync_status" varchar(16) DEFAULT 'shared' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slice_sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slice_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"triggered_by" varchar(32) NOT NULL,
	"previous_version" integer,
	"new_version" integer,
	"items_changed" integer,
	"redaction_count" integer,
	"index_state_live" boolean,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_hash" text,
	"storage_key" text NOT NULL,
	"is_encrypted" boolean DEFAULT false,
	"extracted_text" text,
	"extracted_text_hash" text,
	"source_type" text NOT NULL,
	"source_ref" text,
	"space_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" varchar(32)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"index_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"prompt_template" text DEFAULT '' NOT NULL,
	"section_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"index_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"created_by" text DEFAULT 'generate' NOT NULL,
	"model_id" text,
	"source_digest_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"index_id" text NOT NULL,
	"version_id" uuid,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"model" text NOT NULL,
	"model_tier" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scope_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid,
	"conflict_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scope_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"boundaries" jsonb NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scope_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_token" text,
	"scope_id" uuid,
	"inline_boundaries" jsonb,
	"mode" text DEFAULT 'static' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_active_project" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"active_project_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_active_project_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"boundaries" jsonb NOT NULL,
	"select_spec" jsonb NOT NULL,
	"aggregations" jsonb,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"surface" varchar(16) NOT NULL,
	"surface_client_id" varchar(128),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(32),
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope_snapshot" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pattern_edge_priors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"topic_hint" text NOT NULL,
	"edge_type" varchar(32) NOT NULL,
	"weight" real NOT NULL,
	"rationale" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"mode" varchar(32) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"description" text NOT NULL,
	"confidence" real NOT NULL,
	"supporting_record_ids" text[] DEFAULT '{}',
	"work_style_narrative" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anchor_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_anchor_id" uuid NOT NULL,
	"to_anchor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"weight" real DEFAULT 0.5 NOT NULL,
	"contributor" text,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"artifact_id" text,
	"artifact_type" text NOT NULL,
	"artifact_version" integer,
	"span" jsonb NOT NULL,
	"meaning_text" text NOT NULL,
	"meaning_version" integer DEFAULT 1 NOT NULL,
	"meaning_added_by" text,
	"meaning_added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meaning_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weight" real DEFAULT 0.5 NOT NULL,
	"flavors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding_content" real[],
	"embedding_causal" real[],
	"embedding_context" real[],
	"index_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timeline_annotations" ADD CONSTRAINT "timeline_annotations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timeline_annotations" ADD CONSTRAINT "timeline_annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timeline_summaries" ADD CONSTRAINT "timeline_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_conversation_members" ADD CONSTRAINT "chat_conversation_members_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_conversation_members" ADD CONSTRAINT "chat_conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_conversation_snapshots" ADD CONSTRAINT "chat_conversation_snapshots_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deep_dive_bookmarks" ADD CONSTRAINT "deep_dive_bookmarks_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deep_dive_bookmarks" ADD CONSTRAINT "deep_dive_bookmarks_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deep_dive_bookmarks" ADD CONSTRAINT "deep_dive_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_views" ADD CONSTRAINT "document_views_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_views" ADD CONSTRAINT "document_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "web_captures" ADD CONSTRAINT "web_captures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_documents" ADD CONSTRAINT "space_documents_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_documents" ADD CONSTRAINT "space_documents_external_document_id_external_documents_id_fk" FOREIGN KEY ("external_document_id") REFERENCES "public"."external_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_documents" ADD CONSTRAINT "space_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_documents" ADD CONSTRAINT "space_documents_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaces" ADD CONSTRAINT "spaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaces" ADD CONSTRAINT "spaces_canvas_file_id_files_id_fk" FOREIGN KEY ("canvas_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaces" ADD CONSTRAINT "spaces_strand_id_strands_id_fk" FOREIGN KEY ("strand_id") REFERENCES "public"."strands"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "browser_nav_sessions" ADD CONSTRAINT "browser_nav_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_suggestion_actions" ADD CONSTRAINT "doc_suggestion_actions_suggestion_id_doc_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."doc_suggestions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_suggestion_actions" ADD CONSTRAINT "doc_suggestion_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_suggestions" ADD CONSTRAINT "doc_suggestions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_suggestions" ADD CONSTRAINT "doc_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reference_events" ADD CONSTRAINT "reference_events_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strand_collaborators" ADD CONSTRAINT "strand_collaborators_strand_id_strands_id_fk" FOREIGN KEY ("strand_id") REFERENCES "public"."strands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strand_collaborators" ADD CONSTRAINT "strand_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strand_collaborators" ADD CONSTRAINT "strand_collaborators_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strand_thread_refs" ADD CONSTRAINT "strand_thread_refs_strand_id_strands_id_fk" FOREIGN KEY ("strand_id") REFERENCES "public"."strands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strand_thread_refs" ADD CONSTRAINT "strand_thread_refs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strand_thread_refs" ADD CONSTRAINT "strand_thread_refs_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strands" ADD CONSTRAINT "strands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strands" ADD CONSTRAINT "strands_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_events" ADD CONSTRAINT "thread_events_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_events" ADD CONSTRAINT "thread_events_session_id_thread_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."thread_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_sessions" ADD CONSTRAINT "thread_sessions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_sessions" ADD CONSTRAINT "thread_sessions_recording_session_id_recording_sessions_id_fk" FOREIGN KEY ("recording_session_id") REFERENCES "public"."recording_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "threads" ADD CONSTRAINT "threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_decision_trails" ADD CONSTRAINT "document_decision_trails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_decision_trails" ADD CONSTRAINT "document_decision_trails_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_interpretations" ADD CONSTRAINT "document_interpretations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_interpretations" ADD CONSTRAINT "document_interpretations_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_interpretations" ADD CONSTRAINT "document_interpretations_strand_id_strands_id_fk" FOREIGN KEY ("strand_id") REFERENCES "public"."strands"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_patterns" ADD CONSTRAINT "document_patterns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_patterns" ADD CONSTRAINT "document_patterns_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_trackers" ADD CONSTRAINT "document_trackers_external_document_id_external_documents_id_fk" FOREIGN KEY ("external_document_id") REFERENCES "public"."external_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_trackers" ADD CONSTRAINT "document_trackers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_trackers" ADD CONSTRAINT "document_trackers_doc_thread_id_threads_id_fk" FOREIGN KEY ("doc_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_trackers" ADD CONSTRAINT "document_trackers_ai_thread_id_threads_id_fk" FOREIGN KEY ("ai_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_trackers" ADD CONSTRAINT "document_trackers_browser_thread_id_threads_id_fk" FOREIGN KEY ("browser_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_trackers" ADD CONSTRAINT "document_trackers_user_thread_id_threads_id_fk" FOREIGN KEY ("user_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_documents" ADD CONSTRAINT "external_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_documents" ADD CONSTRAINT "external_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_documents" ADD CONSTRAINT "external_documents_strand_id_strands_id_fk" FOREIGN KEY ("strand_id") REFERENCES "public"."strands"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episodes" ADD CONSTRAINT "episodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episodes" ADD CONSTRAINT "episodes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_index_record_id_index_records_id_fk" FOREIGN KEY ("index_record_id") REFERENCES "public"."index_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "index_records" ADD CONSTRAINT "index_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "index_records" ADD CONSTRAINT "index_records_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "index_records" ADD CONSTRAINT "index_records_thread_event_id_thread_events_id_fk" FOREIGN KEY ("thread_event_id") REFERENCES "public"."thread_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "index_records" ADD CONSTRAINT "index_records_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "section_aliases" ADD CONSTRAINT "section_aliases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "semantic_links" ADD CONSTRAINT "semantic_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "semantic_links" ADD CONSTRAINT "semantic_links_source_record_id_index_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."index_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "semantic_links" ADD CONSTRAINT "semantic_links_target_record_id_index_records_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "public"."index_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notebook_blocks" ADD CONSTRAINT "notebook_blocks_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notebook_blocks" ADD CONSTRAINT "notebook_blocks_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notebook_blocks" ADD CONSTRAINT "notebook_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notebook_blocks" ADD CONSTRAINT "notebook_blocks_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notebook_pages" ADD CONSTRAINT "notebook_pages_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notebooks" ADD CONSTRAINT "notebooks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notebooks" ADD CONSTRAINT "notebooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_files" ADD CONSTRAINT "raw_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_files" ADD CONSTRAINT "raw_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_files" ADD CONSTRAINT "raw_files_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_profiles" ADD CONSTRAINT "memory_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_profile_id_memory_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."memory_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_sections" ADD CONSTRAINT "memory_sections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_sections" ADD CONSTRAINT "memory_sections_version_id_memory_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."memory_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pattern_edge_priors" ADD CONSTRAINT "pattern_edge_priors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pattern_edge_priors" ADD CONSTRAINT "pattern_edge_priors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_patterns" ADD CONSTRAINT "user_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_patterns" ADD CONSTRAINT "user_patterns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_chunks_source_idx" ON "document_chunks" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_chunks_workspace_idx" ON "document_chunks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_conv_snapshots_conv_idx" ON "chat_conversation_snapshots" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conv_snapshots_version_uq" ON "chat_conversation_snapshots" USING btree ("conversation_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conv_dedup_idx" ON "chat_conversations" USING btree ("workspace_id","user_id","chat_source_type","content_hash") WHERE "chat_conversations"."content_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_superseded_idx" ON "chat_messages" USING btree ("superseded_by_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_docs_space_idx" ON "space_documents" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ref_events_thread_time_idx" ON "reference_events" USING btree ("thread_id","time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ref_events_by_id_idx" ON "reference_events" USING btree ("referenced_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strand_collab_strand_idx" ON "strand_collaborators" USING btree ("strand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strand_collab_user_idx" ON "strand_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "str_refs_strand_idx" ON "strand_thread_refs" USING btree ("strand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "str_refs_thread_idx" ON "strand_thread_refs" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strands_workspace_idx" ON "strands" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strands_owner_idx" ON "strands" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strands_status_idx" ON "strands" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strands_public_idx" ON "strands" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strands_last_activity_idx" ON "strands" USING btree ("owner_id","last_activity_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_events_thread_time_idx" ON "thread_events" USING btree ("thread_id","time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_events_key_change_idx" ON "thread_events" USING btree ("thread_id","key_change");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_events_session_idx" ON "thread_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_sessions_thread_idx" ON "thread_sessions" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_sessions_recording_idx" ON "thread_sessions" USING btree ("recording_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_sessions_status_idx" ON "thread_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_sessions_active_idx" ON "thread_sessions" USING btree ("status","thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_workspace_idx" ON "threads" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_owner_idx" ON "threads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_type_idx" ON "threads" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_status_idx" ON "threads" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_workspace_type_status_idx" ON "threads" USING btree ("workspace_id","type","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_trails_file_idx" ON "document_decision_trails" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_interp_file_updated_idx" ON "document_interpretations" USING btree ("file_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_patterns_file_confidence_idx" ON "document_patterns" USING btree ("file_id","confidence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_trackers_ext_doc_idx" ON "document_trackers" USING btree ("external_document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_trackers_user_idx" ON "document_trackers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ext_doc_workspace_idx" ON "external_documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ext_doc_strand_idx" ON "external_documents" USING btree ("strand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ext_doc_external_id_idx" ON "external_documents" USING btree ("external_doc_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episodes_workspace_thread_idx" ON "episodes" USING btree ("workspace_id","thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episodes_status_idx" ON "episodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episodes_started_at_idx" ON "episodes" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_evidence_index_record" ON "evidence_records" USING btree ("index_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_evidence_doc" ON "evidence_records" USING btree ("document_id","section_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_evidence_type" ON "evidence_records" USING btree ("document_id","evidence_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_evidence_workspace" ON "evidence_records" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gws_snapshots_doc_version" ON "gws_snapshots" USING btree ("workspace_id","external_doc_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gws_snapshots_doc_hash" ON "gws_snapshots" USING btree ("external_doc_id","content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_record_states_record" ON "index_record_states" USING btree ("index_record_id","state_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_record_states_hash" ON "index_record_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_record_states_captured" ON "index_record_states" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_record_states_live" ON "index_record_states" USING btree ("index_record_id","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_records_workspace_thread" ON "index_records" USING btree ("workspace_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_index_records_event_id" ON "index_records" USING btree ("thread_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_records_episode" ON "index_records" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_records_doc_time" ON "index_records" USING btree ("document_id","event_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_records_user_time" ON "index_records" USING btree ("user_id","event_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_records_ai" ON "index_records" USING btree ("document_id","is_ai_involved");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_records_magnitude" ON "index_records" USING btree ("workspace_id","index_magnitude");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_records_source_file_version" ON "index_records" USING btree ("source_file_id","source_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_records_editor_importance" ON "index_records" USING btree ("workspace_id","editor_importance");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_section_aliases_doc" ON "section_aliases" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_semantic_links_source" ON "semantic_links" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_semantic_links_target" ON "semantic_links" USING btree ("target_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_semantic_links_cross" ON "semantic_links" USING btree ("cross_user");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_semantic_links_pair" ON "semantic_links" USING btree ("source_record_id","target_record_id","link_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_state_user_workspace" ON "ai_state" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_shared_state_doc" ON "document_shared_state" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ctx_req_responder" ON "context_requests" USING btree ("responder_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ctx_req_requester" ON "context_requests" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ctx_req_workspace" ON "context_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_access_user" ON "index_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_access_workspace" ON "index_access" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_privacy_rules_user" ON "privacy_filter_rules" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_slices_from_user" ON "shared_slices" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_slices_to_user" ON "shared_slices" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_slices_request" ON "shared_slices" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_slices_workspace" ON "shared_slices" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_events_slice" ON "slice_sync_events" USING btree ("slice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_events_type" ON "slice_sync_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_files_hash" ON "raw_files" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_files_user_file" ON "raw_files" USING btree ("user_id","file_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_files_workspace" ON "raw_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_files_source" ON "raw_files" USING btree ("source_type","source_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_files_space" ON "raw_files" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_profiles_user_index_idx" ON "memory_profiles" USING btree ("user_id","index_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_profiles_slug_idx" ON "memory_profiles" USING btree ("user_id","index_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_versions_profile_idx" ON "memory_versions" USING btree ("profile_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_versions_user_index_idx" ON "memory_versions" USING btree ("user_id","index_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_sections_user_index_idx" ON "memory_sections" USING btree ("user_id","index_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_sections_sort_idx" ON "memory_sections" USING btree ("index_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_sections_version_idx" ON "memory_sections" USING btree ("version_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_user_idx" ON "llm_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_created_idx" ON "llm_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_model_idx" ON "llm_usage" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scope_conflicts_user_workspace_idx" ON "scope_conflicts" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scope_definitions_user_workspace_idx" ON "scope_definitions" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scope_sessions_user_workspace_idx" ON "scope_sessions" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scope_sessions_session_token_idx" ON "scope_sessions" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_queries_user_workspace_idx" ON "saved_queries" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_queries_pinned_idx" ON "saved_queries" USING btree ("workspace_id","is_pinned");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_active_idx" ON "sessions" USING btree ("user_id","ended_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_surface_idx" ON "sessions" USING btree ("surface");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_heartbeat_active_idx" ON "sessions" USING btree ("last_heartbeat_at","ended_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pattern_edge_priors_user_topic_idx" ON "pattern_edge_priors" USING btree ("user_id","topic_hint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pattern_edge_priors_run_idx" ON "pattern_edge_priors" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_patterns_user_generated_idx" ON "user_patterns" USING btree ("user_id","generated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_patterns_run_idx" ON "user_patterns" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anchor_edges_workspace_idx" ON "anchor_edges" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anchor_edges_from_idx" ON "anchor_edges" USING btree ("from_anchor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anchor_edges_to_idx" ON "anchor_edges" USING btree ("to_anchor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anchors_workspace_idx" ON "anchors" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anchors_artifact_idx" ON "anchors" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anchors_index_record_idx" ON "anchors" USING btree ("index_record_id");