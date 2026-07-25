import { pgTable, uuid, text, timestamp, pgEnum, jsonb, real } from 'drizzle-orm/pg-core'
import { users } from './users'
import { files } from './files'

// ─── Document Intelligence ─────────────────────────────────────────

export const suggestionTypeEnum = pgEnum('suggestion_type', [
  'clarity',
  'conciseness',
  'tone',
  'grammar',
  'structure',
  'custom',
])

export const suggestionStatusEnum = pgEnum('suggestion_status', [
  'pending',
  'accepted',
  'rejected',
  'dismissed',
])

export const docSuggestions = pgTable('doc_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  suggestionType: suggestionTypeEnum('suggestion_type').notNull(),
  spanText: text('span_text').notNull(),
  originalText: text('original_text').notNull(),
  explanation: text('explanation'),
  variants: jsonb('variants').$type<Array<{ text: string; label: string }>>().default([]),
  confidence: real('confidence').notNull().default(0.7),
  status: suggestionStatusEnum('status').notNull().default('pending'),
  acceptedVariant: text('accepted_variant'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

export const docSuggestionActionEnum = pgEnum('doc_suggestion_action', [
  'accepted',
  'rejected',
  'regenerated',
  'dismissed',
])

export const docSuggestionActions = pgTable('doc_suggestion_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  suggestionId: uuid('suggestion_id')
    .notNull()
    .references(() => docSuggestions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  action: docSuggestionActionEnum('action').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
