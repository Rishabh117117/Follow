/**
 * External Documents schema — tracks Google Docs/Sheets/Slides documents
 * that have been activated as Follow Smart Documents.
 *
 * Sprint G2 — Smart Document Activation
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { users } from './users'
import { strands, threads } from './threads'

export const externalDocTypeEnum = pgEnum('external_doc_type', [
  'google_docs',
  'google_sheets',
  'google_slides',
])

export const externalDocuments = pgTable(
  'external_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    externalDocId: text('external_doc_id').notNull(), // Google's document ID
    docType: externalDocTypeEnum('doc_type').notNull(),
    title: text('title').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    strandId: uuid('strand_id').references(() => strands.id, { onDelete: 'set null' }),
    lastSyncRevision: text('last_sync_revision'), // Google revision ID
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    metadata: jsonb('metadata')
      .$type<{
        lastKnownTitle?: string
        collaboratorCount?: number
        signalCount?: number
        lastSignalAt?: string
        lastContentSnapshot?: string
        lastSnapshotDocType?: string
        lastSheetName?: string
        lastSlideIndex?: number
        lastParagraphCount?: number
        lastSnapshotAt?: string
        source?: string
      }>()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Only one active record per external doc per workspace
    activeDocUnique: unique('ext_doc_active_unique').on(
      table.externalDocId,
      table.workspaceId
    ),
    workspaceIdx: index('ext_doc_workspace_idx').on(table.workspaceId),
    strandIdx: index('ext_doc_strand_idx').on(table.strandId),
    externalDocIdx: index('ext_doc_external_id_idx').on(table.externalDocId),
  })
)

// ─── Document Trackers (multi-user tracking) ──────────────────────────────

export const documentTrackers = pgTable(
  'document_trackers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalDocumentId: uuid('external_document_id')
      .notNull()
      .references(() => externalDocuments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('collaborator'), // 'owner' | 'collaborator'
    docThreadId: uuid('doc_thread_id').references(() => threads.id, { onDelete: 'set null' }),
    aiThreadId: uuid('ai_thread_id').references(() => threads.id, { onDelete: 'set null' }),
    browserThreadId: uuid('browser_thread_id').references(() => threads.id, { onDelete: 'set null' }),
    userThreadId: uuid('user_thread_id').references(() => threads.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => ({
    extDocIdx: index('doc_trackers_ext_doc_idx').on(table.externalDocumentId),
    userIdx: index('doc_trackers_user_idx').on(table.userId),
    uniqueTracker: unique('doc_trackers_unique').on(table.externalDocumentId, table.userId),
  })
)
