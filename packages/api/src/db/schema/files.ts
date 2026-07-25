import { pgTable, uuid, text, timestamp, integer, jsonb, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const fileTypeEnum = pgEnum('file_type', ['file', 'folder', 'notebook'])

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id'),
  parentFolderId: uuid('parent_folder_id'),
  name: text('name').notNull(),
  type: fileTypeEnum('type').notNull(),
  mimeType: text('mime_type'),
  storagePath: text('storage_path'),
  sizeBytes: integer('size_bytes'),
  version: integer('version').notNull().default(1),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const fileVersions = pgTable('file_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  storagePath: text('storage_path').notNull(),
  sizeBytes: integer('size_bytes'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  diffSummary: text('diff_summary'),
})
