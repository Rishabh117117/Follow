import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

const connectionString = process.env['DATABASE_URL']

type DbInstance = ReturnType<typeof drizzlePg<typeof schema>>

let _db: DbInstance | null = null
let _dbReady: Promise<void> | null = null

/**
 * Initialise PGlite with file-based persistence when DATABASE_URL is not set.
 * Tables are created via raw DDL so the full Drizzle schema is available.
 * Data persists in packages/api/data/ across restarts.
 */
async function initPglite() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite')
  const path = await import('path')
  const fs = await import('fs')

  // Use file-based storage so data survives API restarts
  const dataDir = path.join(process.cwd(), 'data', 'pglite')
  fs.mkdirSync(dataDir, { recursive: true })
  const client = new PGlite(dataDir)

  // ── Enum types ──────────────────────────────────────────────────────
  await client.exec(`
    DO $$ BEGIN CREATE TYPE file_type AS ENUM ('file','folder','notebook'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE user_role AS ENUM ('owner','admin','editor','viewer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE conversation_type AS ENUM ('standard','deep_dive','agent_initiated','capture_ask'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE conversation_status AS ENUM ('active','archived'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE message_role AS ENUM ('user','assistant','system'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE timeline_resolution AS ENUM ('15sec','5min','15min','30min','1hr','6hr','12hr','1day','1week','1month'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE annotation_type AS ENUM ('note','correction','bookmark','decision','milestone','question'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE recording_session_status AS ENUM ('active','completed','abandoned'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    -- KNOWLEDGE-EDGES-DROP-1 (2026-04-22): knowledge_entity_type + knowledge_relationship
    -- enums removed here to match the migration that drops them. Restoration: see
    -- _archive/2026-04-22-knowledge-edges-drop/down.sql.
    DO $$ BEGIN CREATE TYPE file_share_permission AS ENUM ('viewer','editor'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('mention','comment','share','invite','agent_complete','prompt_card','system'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE capture_source AS ENUM ('bookmarklet','extension','api'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE nav_session_status AS ENUM ('pending','navigating','spotlighting','completed','failed','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE suggestion_type AS ENUM ('clarity','conciseness','tone','grammar','structure','custom'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE suggestion_status AS ENUM ('pending','accepted','rejected','dismissed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE doc_suggestion_action AS ENUM ('accepted','rejected','regenerated','dismissed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE external_doc_type AS ENUM ('google_docs','google_sheets','google_slides'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE page_background AS ENUM ('blank','ruled','dotted','grid','cornell'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE page_size AS ENUM ('letter','a4','a5','custom'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE notebook_block_type AS ENUM ('text','freehand','shape','image','audio','video','sticky','connector','embed','comment'); EXCEPTION WHEN duplicate_object THEN null; END $$;
  `)

  // ── Tables (order matches FK dependencies) ─────────────────────────
  await client.exec(`
    -- users.ts
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      avatar_url TEXT,
      image TEXT,
      email_verified TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS accounts (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, provider TEXT NOT NULL, provider_account_id TEXT NOT NULL,
      refresh_token TEXT, access_token TEXT, expires_at INTEGER, token_type TEXT,
      scope TEXT, id_token TEXT, session_state TEXT,
      PRIMARY KEY (provider, provider_account_id)
    );
    CREATE TABLE IF NOT EXISTS verification_tokens (
      identifier TEXT NOT NULL, token TEXT NOT NULL, expires TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (identifier, token)
    );
    CREATE TABLE IF NOT EXISTS user_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expertise_areas JSONB DEFAULT '{}',
      prompt_preferences JSONB DEFAULT '{}',
      interaction_style JSONB DEFAULT '{}',
      known_facts JSONB DEFAULT '[]',
      total_prompts_shown INTEGER NOT NULL DEFAULT 0,
      total_prompts_answered INTEGER NOT NULL DEFAULT 0,
      total_prompts_dismissed INTEGER NOT NULL DEFAULT 0,
      automation_preferences JSONB DEFAULT '{}',
      settings JSONB DEFAULT '{}',
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS automation_preferences JSONB DEFAULT '{}';

    -- workspaces.ts
    CREATE TABLE IF NOT EXISTS workspaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role user_role NOT NULL DEFAULT 'viewer',
      invite_email TEXT,
      invite_token TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- spaces.ts
    CREATE TABLE IF NOT EXISTS spaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      canvas_file_id UUID,
      icon TEXT,
      color TEXT,
      is_project BOOLEAN NOT NULL DEFAULT FALSE,
      strand_id UUID,
      metadata JSONB DEFAULT '{}',
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS space_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      external_document_id UUID,
      file_id UUID,
      added_by UUID NOT NULL REFERENCES users(id),
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (space_id, external_document_id),
      UNIQUE (space_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS space_docs_space_idx ON space_documents(space_id);

    -- files.ts
    CREATE TABLE IF NOT EXISTS files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL, space_id UUID, parent_folder_id UUID, name TEXT NOT NULL,
      type file_type NOT NULL, mime_type TEXT, storage_path TEXT, size_bytes INTEGER,
      version INTEGER NOT NULL DEFAULT 1, metadata JSONB DEFAULT '{}',
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS file_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL, storage_path TEXT NOT NULL, size_bytes INTEGER,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      diff_summary TEXT
    );

    -- timeline.ts
    CREATE TABLE IF NOT EXISTS timeline_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      action_type TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id UUID NOT NULL,
      payload JSONB DEFAULT '{}',
      session_id TEXT,
      agent_run_id UUID
    );
    CREATE TABLE IF NOT EXISTS timeline_summaries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      resolution timeline_resolution NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      summary_text TEXT NOT NULL,
      topics TEXT[],
      intent TEXT,
      key_objects UUID[],
      metrics JSONB DEFAULT '{}',
      embedding REAL[]
    );

    -- chat.ts
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      space_id UUID,
      title TEXT NOT NULL DEFAULT 'New Chat',
      type conversation_type NOT NULL DEFAULT 'standard',
      parent_conversation_id UUID,
      context_object_id UUID,
      context_object_type TEXT,
      status conversation_status NOT NULL DEFAULT 'active',
      chat_source_type TEXT DEFAULT 'follow-web',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      role message_role NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      rich_content JSONB,
      attachments JSONB DEFAULT '[]',
      metadata JSONB DEFAULT '{}',
      parent_message_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS deep_dive_bookmarks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Conversation versioning (Sprint MCP-3): snapshots written each time
    -- save_conversation upserts a conversation with new content. The
    -- conversation row carries the latest version + content_hash; older
    -- states live here as point-in-time snapshots.
    CREATE TABLE IF NOT EXISTS chat_conversation_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      messages_json JSONB NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (conversation_id, version)
    );
    CREATE INDEX IF NOT EXISTS chat_conv_snapshots_conv_idx
      ON chat_conversation_snapshots(conversation_id);

    -- knowledge.ts
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      doc_type TEXT NOT NULL,
      content JSONB NOT NULL DEFAULT '{}',
      source_summaries UUID[],
      source_agent_runs UUID[],
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      access_scope TEXT NOT NULL DEFAULT 'workspace',
      embedding REAL[]
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      source_type TEXT NOT NULL,
      source_id UUID NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding REAL[],
      summary TEXT,
      topics TEXT[],
      entities JSONB,
      importance REAL DEFAULT 0.5,
      content_hash TEXT,
      last_agent_run_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS doc_chunks_source_idx ON document_chunks(source_type, source_id);
    CREATE INDEX IF NOT EXISTS doc_chunks_workspace_idx ON document_chunks(workspace_id);

    -- collaboration.ts
    -- KNOWLEDGE-EDGES-DROP-1 (2026-04-22): knowledge_edges CREATE TABLE removed.
    -- See _archive/2026-04-22-knowledge-edges-drop/down.sql for restoration.
    CREATE TABLE IF NOT EXISTS file_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      permission file_share_permission NOT NULL DEFAULT 'viewer',
      shared_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      share_token TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type notification_type NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT,
      metadata JSONB DEFAULT '{}',
      read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_comment_id UUID,
      content TEXT NOT NULL,
      position JSONB,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS webhooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      url TEXT NOT NULL,
      events TEXT[] NOT NULL,
      secret TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      permissions TEXT[] NOT NULL DEFAULT ARRAY['read'],
      last_used_at TIMESTAMPTZ,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS web_captures (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      screenshot TEXT,
      source capture_source NOT NULL DEFAULT 'bookmarklet',
      tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      file_id UUID,
      analyzed BOOLEAN NOT NULL DEFAULT FALSE,
      analysis_result JSONB,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- timeline_annotations (Layer 5)
    CREATE TABLE IF NOT EXISTS timeline_annotations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id),
      user_id UUID REFERENCES users(id),
      agent_run_id UUID,
      target_timestamp TIMESTAMPTZ NOT NULL,
      target_event_id UUID,
      target_summary_id UUID,
      annotation_type annotation_type NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      is_resolved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- recording_sessions (Layer 6 — Live on → off lifecycle)
    CREATE TABLE IF NOT EXISTS recording_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      status recording_session_status NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      duration_ms INTEGER,
      event_count INTEGER DEFAULT 0,
      summary_text TEXT,
      topics TEXT[],
      intent TEXT,
      metrics JSONB DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- browser_nav_sessions (Sprint 26 — Guided Navigation)
    CREATE TABLE IF NOT EXISTS browser_nav_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      target_description TEXT,
      final_url TEXT,
      status nav_session_status NOT NULL DEFAULT 'pending',
      confidence REAL,
      screenshot_data_url TEXT,
      spotlight_fired INTEGER DEFAULT 0,
      fallback_used TEXT,
      error_reason TEXT,
      nav_intent JSONB,
      ranked_results JSONB,
      metadata JSONB DEFAULT '{}',
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    -- doc_suggestions (Sprint 28 — Document Intelligence)
    CREATE TABLE IF NOT EXISTS doc_suggestions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      suggestion_type suggestion_type NOT NULL,
      span_text TEXT NOT NULL,
      original_text TEXT NOT NULL,
      explanation TEXT,
      variants JSONB DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.7,
      status suggestion_status NOT NULL DEFAULT 'pending',
      accepted_variant TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    -- doc_suggestion_actions (Sprint 28 — audit trail for doc suggestions)
    CREATE TABLE IF NOT EXISTS doc_suggestion_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      suggestion_id UUID NOT NULL REFERENCES doc_suggestions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action doc_suggestion_action NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Threads & Strands (Sprint T1)
    DO $$ BEGIN CREATE TYPE thread_type AS ENUM ('user','ai','doc','browser','import'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE thread_status AS ENUM ('active','paused','archived'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE strand_status AS ENUM ('active','paused','archived'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE thread_session_status AS ENUM ('active','distilling','complete','failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE thread_event_type AS ENUM ('edit','navigation','ai_interaction','structural_change','reference','gap','import','session_start','session_end'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE thread_event_magnitude AS ENUM ('low','medium','high'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE reference_by_type AS ENUM ('chat','strand','thread'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE cross_ref_type AS ENUM ('led_to','influenced_by','applied_to','related_to','triggered_by'); EXCEPTION WHEN duplicate_object THEN null; END $$;

    CREATE TABLE IF NOT EXISTS threads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type thread_type NOT NULL,
      name TEXT NOT NULL,
      status thread_status NOT NULL DEFAULT 'active',
      home_strand_id UUID,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS strands (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#7C6EF7',
      status strand_status NOT NULL DEFAULT 'active',
      summary_text TEXT,
      founding_context TEXT,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      strand_instructions TEXT,
      metadata JSONB DEFAULT '{}',
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS strand_thread_refs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      strand_id UUID NOT NULL REFERENCES strands(id) ON DELETE CASCADE,
      thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      added_by UUID NOT NULL REFERENCES users(id),
      visible_to_collaborators BOOLEAN NOT NULL DEFAULT TRUE,
      relevance_weight REAL NOT NULL DEFAULT 1.0,
      UNIQUE (strand_id, thread_id)
    );

    CREATE TABLE IF NOT EXISTS strand_collaborators (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      strand_id UUID NOT NULL REFERENCES strands(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      can_see_user_thread BOOLEAN NOT NULL DEFAULT FALSE,
      can_see_ai_thread BOOLEAN NOT NULL DEFAULT TRUE,
      can_see_doc_threads BOOLEAN NOT NULL DEFAULT TRUE,
      can_see_browser_thread BOOLEAN NOT NULL DEFAULT FALSE,
      invited_by UUID NOT NULL REFERENCES users(id),
      invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (strand_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS thread_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      recording_session_id UUID REFERENCES recording_sessions(id) ON DELETE SET NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      status thread_session_status NOT NULL DEFAULT 'active',
      raw_signal_count INTEGER NOT NULL DEFAULT 0,
      distilled_event_count INTEGER NOT NULL DEFAULT 0,
      last_processed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS thread_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      session_id UUID REFERENCES thread_sessions(id) ON DELETE SET NULL,
      "time" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      label TEXT NOT NULL,
      type thread_event_type NOT NULL,
      magnitude thread_event_magnitude NOT NULL DEFAULT 'low',
      distilled_from TEXT[] DEFAULT ARRAY[]::TEXT[],
      context_notes TEXT,
      key_change BOOLEAN NOT NULL DEFAULT FALSE,
      migrated_from_timeline BOOLEAN NOT NULL DEFAULT FALSE,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reference_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      referenced_by_type reference_by_type NOT NULL,
      referenced_by_id UUID NOT NULL,
      context TEXT,
      "time" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- external-documents.ts (Smart Documents)
    CREATE TABLE IF NOT EXISTS external_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      external_doc_id TEXT NOT NULL,
      doc_type external_doc_type NOT NULL,
      title TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      strand_id UUID REFERENCES strands(id) ON DELETE SET NULL,
      last_sync_revision TEXT,
      activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deactivated_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(external_doc_id, workspace_id)
    );
    CREATE INDEX IF NOT EXISTS ext_doc_workspace_idx ON external_documents(workspace_id);
    CREATE INDEX IF NOT EXISTS ext_doc_strand_idx ON external_documents(strand_id);
    CREATE INDEX IF NOT EXISTS ext_doc_external_id_idx ON external_documents(external_doc_id);

    CREATE TABLE IF NOT EXISTS document_trackers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      external_document_id UUID NOT NULL REFERENCES external_documents(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'collaborator',
      doc_thread_id UUID,
      ai_thread_id UUID,
      browser_thread_id UUID,
      user_thread_id UUID,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      UNIQUE (external_document_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS doc_trackers_ext_doc_idx ON document_trackers(external_document_id);
    CREATE INDEX IF NOT EXISTS doc_trackers_user_idx ON document_trackers(user_id);

    -- semantic-index.ts (Sprint IX-1 — Semantic Index)
    CREATE TABLE IF NOT EXISTS episodes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      summary_text TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      record_count INTEGER NOT NULL DEFAULT 0,
      merged_into_id UUID,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS episodes_workspace_thread_idx ON episodes(workspace_id, thread_id);
    CREATE INDEX IF NOT EXISTS episodes_status_idx ON episodes(status);
    CREATE INDEX IF NOT EXISTS episodes_started_at_idx ON episodes(started_at);

    CREATE TABLE IF NOT EXISTS index_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      thread_event_id UUID NOT NULL REFERENCES thread_events(id) ON DELETE CASCADE,
      thread_type TEXT NOT NULL,
      embedding REAL[],
      embedding_text TEXT NOT NULL,
      index_magnitude TEXT NOT NULL DEFAULT 'small',
      is_key_change BOOLEAN NOT NULL DEFAULT FALSE,
      is_ai_involved BOOLEAN NOT NULL DEFAULT FALSE,
      has_evidence BOOLEAN NOT NULL DEFAULT FALSE,
      engagement_depth REAL NOT NULL DEFAULT 0,
      episode_id UUID REFERENCES episodes(id) ON DELETE SET NULL,
      document_id UUID,
      document_title TEXT,
      section_alias TEXT,
      user_id UUID NOT NULL,
      user_name TEXT,
      event_time TIMESTAMPTZ NOT NULL,
      indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB DEFAULT '{}'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_index_records_event_id ON index_records(thread_event_id);
    CREATE INDEX IF NOT EXISTS idx_index_records_workspace_thread ON index_records(workspace_id, thread_id);
    CREATE INDEX IF NOT EXISTS idx_index_records_episode ON index_records(episode_id);
    CREATE INDEX IF NOT EXISTS idx_index_records_doc_time ON index_records(document_id, event_time);
    CREATE INDEX IF NOT EXISTS idx_index_records_user_time ON index_records(user_id, event_time);
    CREATE INDEX IF NOT EXISTS idx_index_records_ai ON index_records(document_id, is_ai_involved);
    CREATE INDEX IF NOT EXISTS idx_index_records_magnitude ON index_records(workspace_id, index_magnitude);

    CREATE TABLE IF NOT EXISTS semantic_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_record_id UUID NOT NULL REFERENCES index_records(id) ON DELETE CASCADE,
      target_record_id UUID NOT NULL REFERENCES index_records(id) ON DELETE CASCADE,
      similarity REAL NOT NULL,
      link_type TEXT NOT NULL,
      cross_user BOOLEAN NOT NULL DEFAULT FALSE,
      reason TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_links_source ON semantic_links(source_record_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_links_target ON semantic_links(target_record_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_links_cross ON semantic_links(cross_user);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_links_pair ON semantic_links(source_record_id, target_record_id, link_type);

    CREATE TABLE IF NOT EXISTS evidence_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      index_record_id UUID REFERENCES index_records(id) ON DELETE CASCADE,
      document_id UUID,
      user_id UUID,
      section_ref TEXT,
      evidence_type TEXT NOT NULL,
      content_before TEXT,
      content_after TEXT,
      chat_exchange JSONB,
      source_snapshot JSONB,
      hash_chain_prev TEXT,
      record_hash TEXT NOT NULL,
      ownership_tier TEXT NOT NULL DEFAULT 'document',
      retention_policy TEXT,
      redacted_at TIMESTAMPTZ,
      redacted_fields TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_index_record ON evidence_records(index_record_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_doc ON evidence_records(document_id, section_ref);
    CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence_records(document_id, evidence_type);
    CREATE INDEX IF NOT EXISTS idx_evidence_workspace ON evidence_records(workspace_id);

    CREATE TABLE IF NOT EXISTS section_aliases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      document_id UUID NOT NULL,
      old_heading TEXT NOT NULL,
      new_heading TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_section_aliases_doc ON section_aliases(document_id);

    -- notebooks.ts (Sprint N1 — Notebook Page Surface)
    CREATE TABLE IF NOT EXISTS notebooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_id UUID NOT NULL REFERENCES files(id),
      workspace_id UUID NOT NULL,
      page_size page_size NOT NULL DEFAULT 'letter',
      custom_width INTEGER,
      custom_height INTEGER,
      page_count INTEGER NOT NULL DEFAULT 1,
      default_background page_background NOT NULL DEFAULT 'blank',
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notebook_pages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      background page_background NOT NULL DEFAULT 'blank',
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notebook_blocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id UUID NOT NULL REFERENCES notebook_pages(id) ON DELETE CASCADE,
      notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      type notebook_block_type NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      rotation INTEGER DEFAULT 0,
      z_index INTEGER NOT NULL DEFAULT 0,
      locked BOOLEAN DEFAULT FALSE,
      data JSONB NOT NULL,
      created_by UUID REFERENCES users(id),
      last_edited_by UUID REFERENCES users(id),
      ai_generated BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS notebook_blocks_page_idx ON notebook_blocks(page_id);
    CREATE INDEX IF NOT EXISTS notebook_blocks_notebook_idx ON notebook_blocks(notebook_id);

    -- AI State tables (Sprint IX-4)
    CREATE TABLE IF NOT EXISTS ai_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      state_event JSONB NOT NULL DEFAULT '{}',
      state_session JSONB NOT NULL DEFAULT '{}',
      state_persistent JSONB NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      last_event_update TIMESTAMPTZ,
      last_condensation TIMESTAMPTZ,
      last_pattern_detection TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS document_shared_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL UNIQUE,
      workspace_id UUID NOT NULL,
      state JSONB NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      last_updated TIMESTAMPTZ DEFAULT NOW()
    );

    -- Tensor facet embedding columns (Sprint IX-7)
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN embedding_content REAL[];
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN embedding_causal REAL[];
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN embedding_context REAL[];
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;

    -- KNOWLEDGE-EDGES-DROP-1 (2026-04-22): 3 ALTER TABLE knowledge_edges
    -- blocks removed (Sprint T1 cross-thread reference columns). Table no
    -- longer exists. See _archive/2026-04-22-knowledge-edges-drop/down.sql.

    -- Version-linking columns (Sprint IX-8)
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN source_file_id VARCHAR(255);
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN source_version INTEGER;
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN source_content_hash VARCHAR(64);
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;

    -- Sprint CTX-1: user-controlled visibility
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT FALSE;
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN hidden_at TIMESTAMPTZ;
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;

    -- VERSION-B1: version supersession (re-synced docs retire old facts).
    DO $$ BEGIN
      ALTER TABLE index_records ADD COLUMN superseded_at TIMESTAMPTZ;
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;

    -- Anchor substrate (ANCHOR-1, 2026-06-02) — additive; index_records untouched.
    CREATE TABLE IF NOT EXISTS anchors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      artifact_id TEXT,
      artifact_type TEXT NOT NULL,
      artifact_version INTEGER,
      span JSONB NOT NULL,
      meaning_text TEXT NOT NULL,
      meaning_version INTEGER NOT NULL DEFAULT 1,
      meaning_added_by TEXT,
      meaning_added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      meaning_history JSONB NOT NULL DEFAULT '[]',
      weight REAL NOT NULL DEFAULT 0.5,
      flavors JSONB NOT NULL DEFAULT '[]',
      embedding_content REAL[],
      embedding_causal REAL[],
      embedding_context REAL[],
      index_record_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS anchors_workspace_idx ON anchors(workspace_id);
    CREATE INDEX IF NOT EXISTS anchors_artifact_idx ON anchors(artifact_id);
    CREATE INDEX IF NOT EXISTS anchors_index_record_idx ON anchors(index_record_id);

    CREATE TABLE IF NOT EXISTS anchor_edges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      from_anchor_id UUID NOT NULL,
      to_anchor_id UUID NOT NULL,
      kind TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0.5,
      contributor TEXT,
      rationale TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS anchor_edges_workspace_idx ON anchor_edges(workspace_id);
    CREATE INDEX IF NOT EXISTS anchor_edges_from_idx ON anchor_edges(from_anchor_id);
    CREATE INDEX IF NOT EXISTS anchor_edges_to_idx ON anchor_edges(to_anchor_id);

    -- chatSourceType already in CREATE TABLE above

    -- Conversation versioning (Sprint MCP-3): content_hash + version on
    -- chat_conversations, supersededByMessageId on chat_messages so old
    -- versions of messages can be linked forward to their replacements.
    DO $$ BEGIN
      ALTER TABLE chat_conversations ADD COLUMN content_hash TEXT;
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    DO $$ BEGIN
      ALTER TABLE chat_conversations ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    -- Partial unique index: dedupe (workspace, user, source, hash) only when
    -- hash is set. Conversations created by the live chat UI have hash NULL
    -- and are never deduplicated against each other.
    CREATE UNIQUE INDEX IF NOT EXISTS chat_conv_dedup_idx
      ON chat_conversations(workspace_id, user_id, chat_source_type, content_hash)
      WHERE content_hash IS NOT NULL;

    DO $$ BEGIN
      ALTER TABLE chat_messages ADD COLUMN superseded_by_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    CREATE INDEX IF NOT EXISTS chat_messages_superseded_idx
      ON chat_messages(superseded_by_message_id);

    -- MCP API keys (Sprint MCP-1)
    CREATE TABLE IF NOT EXISTS mcp_api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      workspace_id UUID NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'MCP Key',
      permissions TEXT[] DEFAULT ARRAY['{mcp}'],
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );

    -- Raw files (Sprint MCP-2)
    CREATE TABLE IF NOT EXISTS raw_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      workspace_id UUID NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      previous_hash TEXT,
      storage_key TEXT NOT NULL,
      is_encrypted BOOLEAN DEFAULT FALSE,
      extracted_text TEXT,
      extracted_text_hash TEXT,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_raw_files_hash ON raw_files(content_hash);
    CREATE INDEX IF NOT EXISTS idx_raw_files_user_file ON raw_files(user_id, file_name);
    CREATE INDEX IF NOT EXISTS idx_raw_files_workspace ON raw_files(workspace_id);

    -- Memory sections (Sprint WIRE-1): editable memory per user + index
    CREATE TABLE IF NOT EXISTS memory_sections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      index_id TEXT NOT NULL,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS memory_sections_user_index_idx ON memory_sections(user_id, index_id);
    CREATE INDEX IF NOT EXISTS memory_sections_sort_idx ON memory_sections(index_id, sort_order);

    -- Memory profiles + versions (Sprint MEM-1): versioned book-metaphor
    -- memory driven by user-selectable profiles. Each profile produces
    -- memory_versions snapshots; memory_sections rows belong to a version.
    CREATE TABLE IF NOT EXISTS memory_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      index_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prompt_template TEXT NOT NULL DEFAULT '',
      section_keys JSONB NOT NULL DEFAULT '[]',
      is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS memory_profiles_user_index_idx ON memory_profiles(user_id, index_id);
    CREATE INDEX IF NOT EXISTS memory_profiles_slug_idx ON memory_profiles(user_id, index_id, slug);

    CREATE TABLE IF NOT EXISTS memory_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id UUID NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      index_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'generate',
      model_id TEXT,
      source_digest_hash TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS memory_versions_profile_idx ON memory_versions(profile_id, version_number);
    CREATE INDEX IF NOT EXISTS memory_versions_user_index_idx ON memory_versions(user_id, index_id);

    -- memory_sections.version_id (nullable; backfilled on first MEM-1 access)
    DO $$ BEGIN
      ALTER TABLE memory_sections ADD COLUMN version_id UUID REFERENCES memory_versions(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_column THEN null;
    END $$;
    CREATE INDEX IF NOT EXISTS memory_sections_version_idx ON memory_sections(version_id, sort_order);

    -- LLM usage tracking (Sprint WIRE-1)
    CREATE TABLE IF NOT EXISTS llm_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      model_tier TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS llm_usage_user_idx ON llm_usage(user_id);
    CREATE INDEX IF NOT EXISTS llm_usage_created_idx ON llm_usage(created_at);
    CREATE INDEX IF NOT EXISTS llm_usage_model_idx ON llm_usage(model);

    -- Sharing tables (Sprint SH-1/2/3)
    CREATE TABLE IF NOT EXISTS index_access (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE NOT NULL,
      workspace_id UUID NOT NULL,
      passcode_hash VARCHAR(255),
      passcode_salt VARCHAR(64),
      session_token VARCHAR(255),
      session_expires_at TIMESTAMPTZ,
      is_locked BOOLEAN DEFAULT TRUE,
      lock_policy VARCHAR(32) DEFAULT 'on_idle',
      active_preset VARCHAR(32) DEFAULT 'balanced',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS privacy_filter_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      rule_name VARCHAR(128),
      rule_type VARCHAR(32),
      rule_config JSONB NOT NULL,
      scope VARCHAR(32) DEFAULT 'all',
      scope_document_id UUID,
      is_active BOOLEAN DEFAULT TRUE,
      priority INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS context_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id UUID NOT NULL,
      responder_id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      scope_type VARCHAR(32),
      scope_ref_id VARCHAR(255),
      query TEXT NOT NULL,
      status VARCHAR(32) DEFAULT 'pending',
      expires_at TIMESTAMPTZ,
      urgency VARCHAR(16) DEFAULT 'normal',
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      responded_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS shared_slices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id UUID,
      from_user_id UUID NOT NULL,
      to_user_id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      slice_content TEXT NOT NULL,
      slice_metadata JSONB NOT NULL,
      scope_type VARCHAR(32),
      scope_ref_id VARCHAR(255),
      preset_used VARCHAR(32),
      rules_applied INTEGER DEFAULT 0,
      redaction_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      revoked_reason TEXT,
      last_synced_at TIMESTAMPTZ,
      sync_version INTEGER DEFAULT 1,
      sync_status VARCHAR(16) DEFAULT 'shared'
    );

    -- GWS snapshots (Sprint E-1)
    CREATE TABLE IF NOT EXISTS gws_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID NOT NULL,
      external_doc_id VARCHAR(255) NOT NULL,
      doc_type VARCHAR(32) NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash VARCHAR(64) NOT NULL,
      previous_hash VARCHAR(64),
      diff_summary TEXT,
      trigger_type VARCHAR(32) NOT NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Document shared state (Sprint SH-1)
    CREATE TABLE IF NOT EXISTS document_shared_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID UNIQUE,
      workspace_id UUID,
      state JSONB,
      version INTEGER DEFAULT 1,
      last_updated TIMESTAMPTZ DEFAULT NOW()
    );

    -- API keys table (if not in collaboration)
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      permissions TEXT[] DEFAULT ARRAY['{read}'],
      last_used_at TIMESTAMPTZ,
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );
  `)

  // Seed dev user, workspace, and membership so DEV_BYPASS_AUTH works
  // Uses shared constants from @workspace/shared/constants/dev-user.ts
  await client.exec(`
    INSERT INTO users (id, email, name)
    VALUES ('${DEV_USER.id}'::uuid, '${DEV_USER.email}', '${DEV_USER.name}')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO workspaces (id, name, slug, owner_id)
    VALUES ('${DEV_WORKSPACE.id}'::uuid, '${DEV_WORKSPACE.name}', '${DEV_WORKSPACE.slug}', '${DEV_USER.id}'::uuid)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO workspace_members (id, workspace_id, user_id, role)
    SELECT gen_random_uuid(), '${DEV_WORKSPACE.id}'::uuid, '${DEV_USER.id}'::uuid, 'owner'
    WHERE NOT EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = '${DEV_WORKSPACE.id}'::uuid
        AND user_id = '${DEV_USER.id}'::uuid
    );
  `)

  console.info(`[DB] Using file-based PGlite at ${dataDir}`)

  // PGlite drizzle returns PgDatabase subclass — cast for type compat with postgres-js
  _db = drizzlePglite(client, { schema }) as unknown as DbInstance
}

// Kick off init
if (connectionString) {
  const queryClient = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    // Previously 30s — any transient stall held every request for 30 full
    // seconds before failing. 5s is still generous for a local socket and
    // lets react-query's retry kick in on a real problem instead of the
    // browser spinning forever.
    connect_timeout: 5,
    // Keep TCP connections alive so the OS doesn't silently reap long-idle
    // sockets (the main source of "write CONNECT_TIMEOUT" errors on a
    // healthy Postgres container).
    connection: { application_name: 'workspace-api' },
    onnotice: () => {},
  })
  _db = drizzlePg(queryClient, { schema })
  _dbReady = Promise.resolve()
  console.info('[DB] Connected to PostgreSQL')
} else {
  _dbReady = initPglite().catch((err) => {
    console.error('[DB] PGlite init failed:', err)
    throw err
  })
}

/**
 * Ensures the database is ready (PGlite needs async init).
 * Call once at server startup before handling requests.
 */
export async function waitForDb(): Promise<void> {
  if (_dbReady) await _dbReady
}

/**
 * The Drizzle database instance.
 * For PGlite, `waitForDb()` must have resolved before use.
 */
export const db = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    if (!_db) {
      throw new Error('[DB] Database not initialised yet — call waitForDb() first')
    }
    return Reflect.get(_db, prop, receiver)
  },
})

export type Database = DbInstance
