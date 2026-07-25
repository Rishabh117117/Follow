/**
 * Semantic Index Schema (Sprint IX-1)
 *
 * Five tables for the new semantic indexing system:
 * - indexRecords: vector-searchable index of every distilled thread event
 * - semanticLinks: weighted connections between index records
 * - episodes: temporal groupings of related index records
 * - evidenceRecords: content snapshots for significant events (hash-chained)
 * - sectionAliases: canonical section name tracking for documents
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  real,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex,
  varchar,
  vector,
} from 'drizzle-orm/pg-core'
import { threads, threadEvents } from './threads'
import { workspaces } from './workspaces'

// ─── EPISODES (temporal groupings of related activity) ───────────────────────

export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    title: text('title'), // LLM-generated during episode refinement
    status: text('status').notNull().default('open'), // open | closed | merged
    summaryText: text('summary_text'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    recordCount: integer('record_count').notNull().default(0),
    mergedIntoId: uuid('merged_into_id'), // self-ref, can't use .references() here
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceThreadIdx: index('episodes_workspace_thread_idx').on(
      table.workspaceId,
      table.threadId
    ),
    statusIdx: index('episodes_status_idx').on(table.status),
    startedAtIdx: index('episodes_started_at_idx').on(table.startedAt),
  })
)

// ─── INDEX RECORDS (vector-searchable index of thread events) ────────────────

export const indexRecords = pgTable(
  'index_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    threadEventId: uuid('thread_event_id')
      .notNull()
      .references(() => threadEvents.id, { onDelete: 'cascade' }),
    threadType: text('thread_type').notNull(), // doc | ai | browser | user | import (denormalized)

    // Vector embedding (1536 dimensions, same model as knowledgeDocs)
    embedding: vector('embedding', { dimensions: 1536 }),

    // Composite text that was embedded (stored for debugging/re-embedding)
    embeddingText: text('embedding_text').notNull(),

    // Magnitude mapped from thread event (small | medium | large)
    indexMagnitude: text('index_magnitude').notNull().default('small'),

    // Key change flag (denormalized from thread event)
    isKeyChange: boolean('is_key_change').notNull().default(false),

    // AI involvement flag
    isAIInvolved: boolean('is_ai_involved').notNull().default(false),

    // Whether evidence has been captured for this record
    hasEvidence: boolean('has_evidence').notNull().default(false),

    // Engagement depth (0.0-1.0, computed by background job)
    engagementDepth: real('engagement_depth').notNull().default(0),

    // Episode association
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),

    // Document anchoring
    documentId: uuid('document_id'), // native fileId or externalDocument ID
    documentTitle: text('document_title'), // cached for display
    sectionAlias: text('section_alias'), // current section heading

    // User anchoring
    userId: uuid('user_id').notNull(),
    userName: text('user_name'), // cached for display

    // Timestamps
    eventTime: timestamp('event_time', { withTimezone: true }).notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    // Tensor facet embeddings (Sprint IX-7)
    embeddingContent: vector('embedding_content', { dimensions: 768 }), // WHAT happened
    embeddingCausal: vector('embedding_causal', { dimensions: 512 }), // WHY it happened
    embeddingContext: vector('embedding_context', { dimensions: 512 }), // WHERE it happened

    // Version-linking (Sprint IX-8) — nullable: existing records have no version info.
    // `indexedAt` above already exists and is retained.
    sourceFileId: varchar('source_file_id', { length: 255 }), // FK-style ref to files.id / chatConversations.id / notebooks.id
    sourceVersion: integer('source_version'), // version number from fileVersions / gws_snapshots / message sequence
    sourceContentHash: varchar('source_content_hash', { length: 64 }), // sha256 hex of source content at time of indexing

    // Sprint CTX-1: user-controlled visibility
    hidden: boolean('hidden').notNull().default(false),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),

    // VERSION-B1: version supersession. When a newer source_version of the same
    // source_file_id is indexed, the prior version's facts (whose content is no
    // longer present in the document) are swept to `superseded_at`. They are kept
    // for audit / future point-in-time recall but excluded from current
    // retrieval. NULL = current/live. Distinct from `hidden` (manual/low-salience)
    // and `deleted_at` (tombstone) — those lifecycles are not conflated here.
    supersededAt: timestamp('superseded_at', { withTimezone: true }),

    // 2026-04-29: Editor stage scores (§06 stage 05). Populated when the
    // Archivist promotes the node (gated by pipeline-editor-llm flag).
    editorConfidence: real('editor_confidence'),
    editorImportance: real('editor_importance'),
    editorSalience: real('editor_salience'),
    editorFreshness: varchar('editor_freshness', { length: 16 }),
    editorRunAt: timestamp('editor_run_at', { withTimezone: true }),

    // 2026-04-29: Soft-delete (tombstone) lifecycle. Read paths filter
    // `deleted_at IS NULL`; hard delete only happens in the GC scheduler
    // after a 30-day retention window. Preserves the supersession chain +
    // audit trail per v5.2 §06.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    deletionReason: varchar('deletion_reason', { length: 32 }), // 'user' | 'gdpr' | 'expiry' | 'cascade'
    deletionScope: varchar('deletion_scope', { length: 16 }), // 'record' | 'source' | 'episode'
  },
  (table) => ({
    workspaceThreadIdx: index('idx_index_records_workspace_thread').on(
      table.workspaceId,
      table.threadId
    ),
    eventIdIdx: uniqueIndex('idx_index_records_event_id').on(table.threadEventId),
    episodeIdx: index('idx_index_records_episode').on(table.episodeId),
    docTimeIdx: index('idx_index_records_doc_time').on(table.documentId, table.eventTime),
    userTimeIdx: index('idx_index_records_user_time').on(table.userId, table.eventTime),
    aiInvolvedIdx: index('idx_index_records_ai').on(table.documentId, table.isAIInvolved),
    magnitudeIdx: index('idx_index_records_magnitude').on(table.workspaceId, table.indexMagnitude),
    // Sprint IX-8: composite index for version queries
    sourceFileVersionIdx: index('idx_index_records_source_file_version').on(
      table.sourceFileId,
      table.sourceVersion
    ),
    // 2026-04-29: Editor importance for top-N retrieval queries
    editorImportanceIdx: index('idx_index_records_editor_importance').on(
      table.workspaceId,
      table.editorImportance
    ),
  })
)

// ─── SEMANTIC LINKS (weighted connections between index records) ──────────────

export const semanticLinks = pgTable(
  'semantic_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sourceRecordId: uuid('source_record_id')
      .notNull()
      .references(() => indexRecords.id, { onDelete: 'cascade' }),
    targetRecordId: uuid('target_record_id')
      .notNull()
      .references(() => indexRecords.id, { onDelete: 'cascade' }),
    similarity: real('similarity').notNull(), // 0-1 cosine similarity
    linkType: text('link_type').notNull(), // continuation | elaboration | contradiction | cause_effect | parallel | reference
    crossUser: boolean('cross_user').notNull().default(false),
    reason: text('reason'), // optional human-readable explanation
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // 2026-04-29: tombstone lifecycle (mirrors index_records).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    deletionReason: varchar('deletion_reason', { length: 32 }),
  },
  (table) => ({
    sourceIdx: index('idx_semantic_links_source').on(table.sourceRecordId),
    targetIdx: index('idx_semantic_links_target').on(table.targetRecordId),
    crossUserIdx: index('idx_semantic_links_cross').on(table.crossUser),
    uniquePairIdx: uniqueIndex('idx_semantic_links_pair').on(
      table.sourceRecordId,
      table.targetRecordId,
      table.linkType
    ),
  })
)

// ─── EVIDENCE RECORDS (content snapshots, hash-chained for integrity) ────────

export const evidenceRecords = pgTable(
  'evidence_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    indexRecordId: uuid('index_record_id').references(() => indexRecords.id, {
      onDelete: 'cascade',
    }), // nullable for sealed snapshots + user clips
    documentId: uuid('document_id'),
    userId: uuid('user_id'),
    sectionRef: text('section_ref'),

    // Evidence type
    // content_change | ai_accepted | ai_rejected | source_introduced | import |
    // sealed_snapshot | user_clip | legal_hold | legal_hold_lifted
    evidenceType: text('evidence_type').notNull(),

    // Content snapshots (nullable — depends on evidence type)
    contentBefore: text('content_before'),
    contentAfter: text('content_after'),
    chatExchange: jsonb('chat_exchange').$type<{
      question?: string
      response?: string
      model?: string
      turnId?: string
    } | null>(),
    sourceSnapshot: jsonb('source_snapshot').$type<Record<string, unknown> | null>(),

    // Hash chain integrity
    hashChainPrev: text('hash_chain_prev'), // hash of previous evidence record for this document
    recordHash: text('record_hash').notNull(), // SHA256 of this record's content

    // Ownership & retention
    ownershipTier: text('ownership_tier').notNull().default('document'), // user | document | org
    retentionPolicy: text('retention_policy'),
    redactedAt: timestamp('redacted_at', { withTimezone: true }),
    redactedFields: text('redacted_fields').array(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    indexRecordIdx: index('idx_evidence_index_record').on(table.indexRecordId),
    docIdx: index('idx_evidence_doc').on(table.documentId, table.sectionRef),
    typeIdx: index('idx_evidence_type').on(table.documentId, table.evidenceType),
    workspaceIdx: index('idx_evidence_workspace').on(table.workspaceId),
  })
)

// ─── GWS SNAPSHOTS (Sprint IX-9 — Follow's own versioned history of Google docs) ──
//
// Follow doesn't own Google documents, so we capture our own point-in-time
// content snapshots with a per-doc version number and hash chain. Each snapshot
// references the previous snapshot's content_hash so integrity can be verified.

export const gwsSnapshots = pgTable(
  'gws_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    externalDocId: varchar('external_doc_id', { length: 255 }).notNull(), // Google's document ID
    docType: varchar('doc_type', { length: 32 }).notNull(), // 'document' | 'spreadsheet' | 'presentation'
    version: integer('version').notNull(), // sequential, per-doc
    content: text('content').notNull(), // captured text content
    contentHash: varchar('content_hash', { length: 64 }).notNull(), // sha256 of content
    previousHash: varchar('previous_hash', { length: 64 }), // hash of previous snapshot (chain)
    diffSummary: text('diff_summary'), // human-readable diff vs previous
    triggerType: varchar('trigger_type', { length: 32 }).notNull(), // 'periodic' | 'significant_edit' | 'manual' | 'pre_share'
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    docVersionIdx: index('idx_gws_snapshots_doc_version').on(
      table.workspaceId,
      table.externalDocId,
      table.version
    ),
    docHashIdx: index('idx_gws_snapshots_doc_hash').on(table.externalDocId, table.contentHash),
  })
)

// ─── SECTION ALIASES (track heading renames across edits) ────────────────────

export const sectionAliases = pgTable(
  'section_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    oldHeading: text('old_heading').notNull(),
    newHeading: text('new_heading').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    docIdx: index('idx_section_aliases_doc').on(table.documentId),
  })
)

// ─── INDEX RECORD STATES (Sprint IX-10 — live vs static history) ─────────────
//
// `index_records` rows are mutable: engagement_depth, hasEvidence, links all
// drift over time. For audit + provenance + sharing, we capture point-in-time
// state snapshots:
//
//   - 'live'   — the current mutable view; new ones supersede the previous
//                live row (linked via supersededBy)
//   - 'static' — frozen audit snapshot, never modified after creation
//                (used as "what did the AI know when this evidence was captured?")
//
// `indexRecordId` is a plain uuid (not a FK) to keep this table independent of
// the `index_records` row lifecycle and avoid forward-reference complications.
// Hash-based dedup means re-capturing identical state is a no-op.

export const indexRecordStates = pgTable(
  'index_record_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    indexRecordId: uuid('index_record_id').notNull(),
    stateType: varchar('state_type', { length: 16 }).notNull(), // 'live' | 'static'
    stateHash: varchar('state_hash', { length: 64 }).notNull(), // sha256 of serialized state

    // Frozen copies of index_record fields at capture time
    engagementDepth: real('engagement_depth'),
    isKeyChange: boolean('is_key_change'),
    hasEvidence: boolean('has_evidence'),
    documentId: varchar('document_id', { length: 255 }),
    documentTitle: text('document_title'),
    sectionAlias: text('section_alias'),
    embeddingText: text('embedding_text'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Version refs copied from IX-8 columns
    sourceFileId: varchar('source_file_id', { length: 255 }),
    sourceVersion: integer('source_version'),
    sourceContentHash: varchar('source_content_hash', { length: 64 }),

    // Capture context
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    capturedBy: varchar('captured_by', { length: 64 }),
    // 'indexer' | 'reference_agent' | 'manual' | 'share_event'
    captureReason: text('capture_reason'),

    // Live-state chain — the newer live row that replaced this one (null = current)
    supersededBy: uuid('superseded_by'),

    // 2026-04-29: tombstone lifecycle. State rows are kept after the parent
    // index_records row is tombstoned so the supersession chain stays
    // queryable for audit. They get tombstoned together via the helper, then
    // the GC sweeps both after the retention window.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    deletionReason: varchar('deletion_reason', { length: 32 }),
  },
  (table) => ({
    recordStateIdx: index('idx_record_states_record').on(table.indexRecordId, table.stateType),
    hashIdx: index('idx_record_states_hash').on(table.stateHash),
    capturedAtIdx: index('idx_record_states_captured').on(table.capturedAt),
    liveIdx: index('idx_record_states_live').on(table.indexRecordId, table.deletedAt),
  })
)
