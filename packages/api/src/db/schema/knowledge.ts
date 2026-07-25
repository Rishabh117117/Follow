import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  vector,
  integer,
  real,
  index,
} from 'drizzle-orm/pg-core'

export const knowledgeDocs = pgTable('knowledge_docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  docType: text('doc_type').notNull(),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  sourceSummaries: uuid('source_summaries').array(),
  sourceAgentRuns: uuid('source_agent_runs').array(),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
  accessScope: text('access_scope').notNull().default('workspace'),
  embedding: vector('embedding', { dimensions: 1536 }),
})

// ─── Document Chunks (indexed content for vector search) ──────────────────

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    sourceType: text('source_type').notNull(), // 'file' | 'external_document' | 'thread_event' | 'timeline_summary'
    sourceId: uuid('source_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    // Agent-enriched fields
    summary: text('summary'),
    topics: text('topics').array(),
    entities: jsonb('entities').$type<{
      people?: string[]
      decisions?: string[]
      dates?: string[]
      actionItems?: string[]
    }>(),
    importance: real('importance').default(0.5), // 0.0-1.0
    contentHash: text('content_hash'), // for incremental change detection
    lastAgentRunAt: timestamp('last_agent_run_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceIdx: index('doc_chunks_source_idx').on(table.sourceType, table.sourceId),
    workspaceIdx: index('doc_chunks_workspace_idx').on(table.workspaceId),
  })
)
