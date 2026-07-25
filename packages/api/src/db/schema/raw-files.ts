/**
 * Raw Files Schema (Sprint MCP-2)
 *
 * Content-addressed file storage backed by S3/MinIO.
 * Supports hash-based dedup and version chaining.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  index,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { workspaces } from './workspaces'
import { spaces } from './spaces'

export const rawFiles = pgTable(
  'raw_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),

    // Identity
    fileName: text('file_name').notNull(),
    filePath: text('file_path'),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),

    // Content addressing
    contentHash: text('content_hash').notNull(),
    version: integer('version').default(1).notNull(),
    previousHash: text('previous_hash'),

    // Storage
    storageKey: text('storage_key').notNull(),
    isEncrypted: boolean('is_encrypted').default(false),

    // Extracted text (for indexing — raw file stays in S3)
    extractedText: text('extracted_text'),
    extractedTextHash: text('extracted_text_hash'),

    // Source tracking
    sourceType: text('source_type').notNull(), // 'local', 'upload', 'gws', 'chat_artifact'
    sourceRef: text('source_ref'),

    // STABILIZE-3: optional binding to a project index (a `spaces` row).
    // When set, the Desktop Agent (or web uploader) has declared that this
    // file belongs to that specific index; queries scoped to the index
    // restrict by this column.
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'set null' }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    deletionReason: varchar('deletion_reason', { length: 32 }),
  },
  (table) => ({
    hashIdx: index('idx_raw_files_hash').on(table.contentHash),
    userFileIdx: index('idx_raw_files_user_file').on(table.userId, table.fileName),
    workspaceIdx: index('idx_raw_files_workspace').on(table.workspaceId),
    sourceIdx: index('idx_raw_files_source').on(table.sourceType, table.sourceRef),
    spaceIdx: index('idx_raw_files_space').on(table.spaceId),
  })
)
