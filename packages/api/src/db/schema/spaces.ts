import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { workspaces } from './workspaces'
import { files } from './files'
import { strands } from './threads'
import { externalDocuments } from './external-documents'

export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  canvasFileId: uuid('canvas_file_id').references(() => files.id, { onDelete: 'set null' }),
  icon: text('icon'),
  color: text('color'),
  isProject: boolean('is_project').notNull().default(false),
  // V41-DISCOVER-1: per-index opt-in for the Discover ability. Default FALSE
  // across the board — a space's index is invisible to Discover until the
  // owner explicitly opts in. `discoverableScope` widens the net beyond
  // the current workspace once opted in.
  discoverable: boolean('discoverable').notNull().default(false),
  discoverableAt: timestamp('discoverable_at', { withTimezone: true }),
  discoverableScope: text('discoverable_scope')
    .$type<'workspace' | 'org' | 'public'>()
    .default('workspace'),
  strandId: uuid('strand_id').references(() => strands.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata')
    .$type<{
      projectType?: string
      settings?: Record<string, unknown>
    }>()
    .default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// ─── SPACE DOCUMENTS (Project ↔ Document membership) ─────────────────────

export const spaceDocuments = pgTable(
  'space_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    externalDocumentId: uuid('external_document_id').references(() => externalDocuments.id, {
      onDelete: 'cascade',
    }),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIdx: index('space_docs_space_idx').on(table.spaceId),
    uniqueExtDoc: unique('space_docs_ext_unique').on(table.spaceId, table.externalDocumentId),
    uniqueFile: unique('space_docs_file_unique').on(table.spaceId, table.fileId),
  })
)
