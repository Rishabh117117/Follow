import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  vector,
  boolean,
  integer,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { workspaces } from './workspaces'

export const timelineEvents = pgTable('timeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  actionType: text('action_type').notNull(),
  objectType: text('object_type').notNull(),
  objectId: uuid('object_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  sessionId: text('session_id'),
  agentRunId: uuid('agent_run_id'),
})

export const timelineResolutionEnum = pgEnum('timeline_resolution', [
  '15sec',
  '5min',
  '15min',
  '30min',
  '1hr',
  '6hr',
  '12hr',
  '1day',
  '1week',
  '1month',
])

export const timelineSummaries = pgTable('timeline_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  resolution: timelineResolutionEnum('resolution').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  summaryText: text('summary_text').notNull(),
  topics: text('topics').array(),
  intent: text('intent'),
  keyObjects: uuid('key_objects').array(),
  metrics: jsonb('metrics').$type<Record<string, unknown>>().default({}),
  embedding: vector('embedding', { dimensions: 1536 }),
})

// ─── Layer 5: Timeline Annotations (shared editable layer) ─────────

export const annotationTypeEnum = pgEnum('annotation_type', [
  'note',
  'correction',
  'bookmark',
  'decision',
  'milestone',
  'question',
])

export const timelineAnnotations = pgTable('timeline_annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  userId: uuid('user_id').references(() => users.id),
  agentRunId: uuid('agent_run_id'),
  targetTimestamp: timestamp('target_timestamp', { withTimezone: true }).notNull(),
  targetEventId: uuid('target_event_id'),
  targetSummaryId: uuid('target_summary_id'),
  annotationType: annotationTypeEnum('annotation_type').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  isResolved: boolean('is_resolved').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ─── Layer 6: Recording Sessions (Live on → off lifecycle) ─────────

export const recordingSessionStatusEnum = pgEnum('recording_session_status', [
  'active',
  'completed',
  'abandoned',
])

export const recordingSessions = pgTable('recording_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  status: recordingSessionStatusEnum('status').notNull().default('active'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  eventCount: integer('event_count').default(0),
  summaryText: text('summary_text'),
  topics: text('topics').array(),
  intent: text('intent'),
  metrics: jsonb('metrics').$type<Record<string, unknown>>().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
