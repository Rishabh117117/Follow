import { pgTable, uuid, text, integer, jsonb, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core'
import { users } from './users'
import { files } from './files'
import type { NotebookBlockData } from '@workspace/shared/types'

export const pageBackgroundEnum = pgEnum('page_background', [
  'blank',
  'ruled',
  'dotted',
  'grid',
  'cornell',
])

export const pageSizeEnum = pgEnum('page_size', ['letter', 'a4', 'a5', 'custom'])

export const blockTypeEnum = pgEnum('notebook_block_type', [
  'text',
  'freehand',
  'shape',
  'image',
  'audio',
  'video',
  'sticky',
  'connector',
  'embed',
  'comment',
])

export const notebooks = pgTable('notebooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .references(() => files.id)
    .notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  pageSize: pageSizeEnum('page_size').default('letter').notNull(),
  customWidth: integer('custom_width'),
  customHeight: integer('custom_height'),
  pageCount: integer('page_count').default(1).notNull(),
  defaultBackground: pageBackgroundEnum('default_background').default('blank').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const notebookPages = pgTable('notebook_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  notebookId: uuid('notebook_id')
    .references(() => notebooks.id, { onDelete: 'cascade' })
    .notNull(),
  pageNumber: integer('page_number').notNull(),
  background: pageBackgroundEnum('background').default('blank').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const notebookBlocks = pgTable('notebook_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id')
    .references(() => notebookPages.id, { onDelete: 'cascade' })
    .notNull(),
  notebookId: uuid('notebook_id')
    .references(() => notebooks.id, { onDelete: 'cascade' })
    .notNull(),
  type: blockTypeEnum('type').notNull(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  rotation: integer('rotation').default(0),
  zIndex: integer('z_index').default(0).notNull(),
  locked: boolean('locked').default(false),
  data: jsonb('data').$type<NotebookBlockData>().notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  lastEditedBy: uuid('last_edited_by').references(() => users.id),
  aiGenerated: boolean('ai_generated').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
