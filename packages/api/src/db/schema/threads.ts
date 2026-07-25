import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  boolean,
  integer,
  real,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { workspaces } from './workspaces'
import { recordingSessions } from './timeline'

// ─── THREAD TYPES ──────────────────────────────────────────────────────────

export const threadTypeEnum = pgEnum('thread_type', [
  'user', // behavioural signals: browsing, navigation, attention
  'ai', // conversation signals: prompts, responses, accepted/rejected
  'doc', // document signals: edits, structure changes, AI applied
  'browser', // raw navigation sequence: every URL hop
  'import', // ingested content: parsed external AI exports
])

export const threadStatusEnum = pgEnum('thread_status', [
  'active',
  'paused',
  'archived',
])

export const strandStatusEnum = pgEnum('strand_status', [
  'active',
  'paused',
  'archived',
])

export const threadSessionStatusEnum = pgEnum('thread_session_status', [
  'active',
  'distilling',
  'complete',
  'failed',
])

export const eventTypeEnum = pgEnum('thread_event_type', [
  'edit',
  'navigation',
  'ai_interaction',
  'structural_change',
  'reference',
  'gap',
  'import',
  'session_start',
  'session_end',
])

export const eventMagnitudeEnum = pgEnum('thread_event_magnitude', [
  'low',
  'medium',
  'high',
])

export const referenceByTypeEnum = pgEnum('reference_by_type', [
  'chat',
  'strand',
  'thread',
])

export const crossRefTypeEnum = pgEnum('cross_ref_type', [
  'led_to',
  'influenced_by',
  'applied_to',
  'related_to',
  'triggered_by',
])

// ─── THREADS ───────────────────────────────────────────────────────────────

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: threadTypeEnum('type').notNull(),
    name: text('name').notNull(),
    status: threadStatusEnum('status').notNull().default('active'),
    homeStrandId: uuid('home_strand_id'), // FK added via ALTER after strands table created
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}), // { fileId?, domain?, importSource? }
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('threads_workspace_idx').on(table.workspaceId),
    ownerIdx: index('threads_owner_idx').on(table.ownerId),
    typeIdx: index('threads_type_idx').on(table.type),
    statusIdx: index('threads_status_idx').on(table.status),
    workspaceTypeStatusIdx: index('threads_workspace_type_status_idx').on(table.workspaceId, table.type, table.status),
  })
)

// ─── STRANDS ───────────────────────────────────────────────────────────────

export const strands = pgTable(
  'strands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#7C6EF7'), // hex
    status: strandStatusEnum('status').notNull().default('active'),
    summaryText: text('summary_text'),
    foundingContext: text('founding_context'), // owner-provided background history
    isPublic: boolean('is_public').notNull().default(false),
    strandInstructions: text('strand_instructions'), // Thread Speaker scope boundary
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('strands_workspace_idx').on(table.workspaceId),
    ownerIdx: index('strands_owner_idx').on(table.ownerId),
    statusIdx: index('strands_status_idx').on(table.status),
    publicIdx: index('strands_public_idx').on(table.isPublic),
    lastActivityIdx: index('strands_last_activity_idx').on(table.ownerId, table.lastActivityAt),
  })
)

// Add FK from threads to strands after both tables defined:
// ALTER TABLE threads ADD CONSTRAINT threads_home_strand_id_fk
//   FOREIGN KEY (home_strand_id) REFERENCES strands(id) ON DELETE SET NULL;

// ─── STRAND → THREAD REFERENCES ────────────────────────────────────────────

export const strandThreadRefs = pgTable(
  'strand_thread_refs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    strandId: uuid('strand_id')
      .notNull()
      .references(() => strands.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id),
    visibleToCollaborators: boolean('visible_to_collaborators').notNull().default(true),
    relevanceWeight: real('relevance_weight').notNull().default(1.0), // 0.1-1.0: how central this thread is to the strand
  },
  (table) => ({
    strandIdx: index('str_refs_strand_idx').on(table.strandId),
    threadIdx: index('str_refs_thread_idx').on(table.threadId),
    uniqueRef: unique('str_refs_unique').on(table.strandId, table.threadId),
  })
)

// ─── STRAND COLLABORATORS ──────────────────────────────────────────────────

export const strandCollaborators = pgTable(
  'strand_collaborators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    strandId: uuid('strand_id')
      .notNull()
      .references(() => strands.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    canSeeUserThread: boolean('can_see_user_thread').notNull().default(false),
    canSeeAiThread: boolean('can_see_ai_thread').notNull().default(true),
    canSeeDocThreads: boolean('can_see_doc_threads').notNull().default(true),
    canSeeBrowserThread: boolean('can_see_browser_thread').notNull().default(false),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    strandIdx: index('strand_collab_strand_idx').on(table.strandId),
    userIdx: index('strand_collab_user_idx').on(table.userId),
    uniqueCollab: unique('strand_collab_unique').on(table.strandId, table.userId),
  })
)

// ─── THREAD SESSIONS ───────────────────────────────────────────────────────

export const threadSessions = pgTable(
  'thread_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    recordingSessionId: uuid('recording_session_id').references(() => recordingSessions.id, {
      onDelete: 'set null',
    }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    status: threadSessionStatusEnum('status').notNull().default('active'),
    rawSignalCount: integer('raw_signal_count').notNull().default(0),
    distilledEventCount: integer('distilled_event_count').notNull().default(0),
    lastProcessedAt: timestamp('last_processed_at', { withTimezone: true }),
  },
  (table) => ({
    threadIdx: index('thread_sessions_thread_idx').on(table.threadId),
    recordingIdx: index('thread_sessions_recording_idx').on(table.recordingSessionId),
    statusIdx: index('thread_sessions_status_idx').on(table.status),
    activeStatusIdx: index('thread_sessions_active_idx').on(table.status, table.threadId),
  })
)

// ─── THREAD EVENTS (permanent distilled record) ────────────────────────────

export const threadEvents = pgTable(
  'thread_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => threadSessions.id, { onDelete: 'set null' }),
    time: timestamp('time', { withTimezone: true }).notNull().defaultNow(),
    label: text('label').notNull(), // human-readable, past tense
    type: eventTypeEnum('type').notNull(),
    magnitude: eventMagnitudeEnum('magnitude').notNull().default('low'),
    distilledFrom: text('distilled_from').array().default([]), // signal types consumed
    contextNotes: text('context_notes'), // why this happened (1 sentence max)
    keyChange: boolean('key_change').notNull().default(false),
    migratedFromTimeline: boolean('migrated_from_timeline').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadTimeIdx: index('thread_events_thread_time_idx').on(table.threadId, table.time),
    keyChangeIdx: index('thread_events_key_change_idx').on(table.threadId, table.keyChange),
    sessionIdx: index('thread_events_session_idx').on(table.sessionId),
  })
)

// ─── REFERENCE EVENTS ──────────────────────────────────────────────────────

export const referenceEvents = pgTable(
  'reference_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    referencedByType: referenceByTypeEnum('referenced_by_type').notNull(),
    referencedById: uuid('referenced_by_id').notNull(), // chat_id, strand_id, or thread_id
    context: text('context'), // what the reference was about
    time: timestamp('time', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadTimeIdx: index('ref_events_thread_time_idx').on(table.threadId, table.time),
    byIdIdx: index('ref_events_by_id_idx').on(table.referencedById),
  })
)
