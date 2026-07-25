import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  primaryKey,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users'

export const conversationTypeEnum = pgEnum('conversation_type', [
  'standard',
  'deep_dive',
  'agent_initiated',
  'capture_ask',
  'group',
])

export const conversationMemberRoleEnum = pgEnum('conversation_member_role', [
  'owner',
  'member',
])

export const conversationStatusEnum = pgEnum('conversation_status', ['active', 'archived'])

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system'])

export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id'),
    title: text('title').notNull().default('New Chat'),
    type: conversationTypeEnum('type').notNull().default('standard'),
    parentConversationId: uuid('parent_conversation_id'),
    contextObjectId: uuid('context_object_id'),
    contextObjectType: text('context_object_type'),
    status: conversationStatusEnum('status').notNull().default('active'),
    chatSourceType: text('chat_source_type').default('follow-web'),
    /** Sprint MCP-3: SHA-256 over normalized messages for idempotent upsert. */
    contentHash: text('content_hash'),
    /** Sprint MCP-3: monotonically incremented when a save replaces content. */
    version: integer('version').notNull().default(1),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedupeIdx: uniqueIndex('chat_conv_dedup_idx')
      .on(t.workspaceId, t.userId, t.chatSourceType, t.contentHash)
      .where(sql`${t.contentHash} IS NOT NULL`),
  })
)

export const chatConversationMembers = pgTable(
  'chat_conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: conversationMemberRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conversationId, t.userId] }),
  })
)

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull().default(''),
    richContent: jsonb('rich_content').$type<Record<string, unknown>[] | null>(),
    attachments: jsonb('attachments').$type<Record<string, unknown>[]>().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    parentMessageId: uuid('parent_message_id'),
    /**
     * Sprint MCP-3: when set, this message has been replaced by a newer
     * version. Live queries filter `superseded_by_message_id IS NULL` to
     * show only the current version; history viewers walk the chain.
     */
    supersededByMessageId: uuid('superseded_by_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    supersededIdx: index('chat_messages_superseded_idx').on(t.supersededByMessageId),
  })
)

/**
 * Sprint MCP-3: point-in-time snapshots of a conversation. Written by
 * save_conversation each time the content hash changes. Each snapshot
 * captures the title and full messages payload (including reasoning
 * trail + rich content + attachments) at version N.
 */
export const chatConversationSnapshots = pgTable(
  'chat_conversation_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    messagesJson: jsonb('messages_json').$type<Record<string, unknown>[]>().notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convIdx: index('chat_conv_snapshots_conv_idx').on(t.conversationId),
    versionUq: uniqueIndex('chat_conv_snapshots_version_uq').on(t.conversationId, t.version),
  })
)

export const deepDiveBookmarks = pgTable('deep_dive_bookmarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => chatConversations.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id')
    .notNull()
    .references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
