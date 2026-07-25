import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  boolean,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { files } from './files'

// KNOWLEDGE-EDGES-DROP-1 (2026-04-22): the knowledge_edges table definition
// and its two supporting enums (knowledge_entity_type, knowledge_relationship)
// were removed here. The migration that dropped them in the DB is
// `packages/api/src/db/migrations/0002_drop_knowledge_edges.sql`. The pre-drop
// schema snapshot lives at
// `_archive/2026-04-22-knowledge-edges-drop/snapshots/packages/api/src/db/schema/collaboration.ts`.

// ─── File Shares ──────────────────────────────────────────────────────

export const fileSharePermissionEnum = pgEnum('file_share_permission', ['viewer', 'editor'])

export const fileShares = pgTable('file_shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  permission: fileSharePermissionEnum('permission').notNull().default('viewer'),
  sharedBy: uuid('shared_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  shareToken: text('share_token'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Document Views (last-seen tracking for "While You Were Away") ────
export const documentViews = pgTable(
  'document_views',
  {
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fileId, t.userId] }),
  })
)

// ─── Notifications ────────────────────────────────────────────────────

export const notificationTypeEnum = pgEnum('notification_type', [
  'mention',
  'comment',
  'share',
  'invite',
  'agent_complete',
  'prompt_card',
  'system',
  'tension',
  'conflict',
])

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  link: text('link'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Comments ─────────────────────────────────────────────────────────

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  parentCommentId: uuid('parent_comment_id'),
  content: text('content').notNull(),
  position: jsonb('position').$type<Record<string, unknown> | null>(),
  resolved: boolean('resolved').notNull().default(false),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Webhooks ─────────────────────────────────────────────────────────

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  url: text('url').notNull(),
  events: text('events').array().notNull(),
  secret: text('secret').notNull(),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Web Captures ────────────────────────────────────────────────────

export const captureSourceEnum = pgEnum('capture_source', ['bookmarklet', 'extension', 'api'])

export const webCaptures = pgTable('web_captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  screenshot: text('screenshot'),
  source: captureSourceEnum('source').notNull().default('bookmarklet'),
  tags: text('tags').array().notNull().default([]),
  fileId: uuid('file_id'),
  analyzed: boolean('analyzed').notNull().default(false),
  analysisResult: jsonb('analysis_result').$type<Record<string, unknown>>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── API Keys ─────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  permissions: text('permissions').array().notNull().default(['{read}']),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
})
