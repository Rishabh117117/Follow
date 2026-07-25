/**
 * Memory Sections (Sprint WIRE-1)
 *
 * Persistent, editable memory content per user + index (personal or project).
 * Each user has a set of sections per index (Overview, Differentiators, etc.)
 * that they can edit inline in the Memory view.
 */

import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { memoryVersions } from './memory-profiles'

export const memorySections = pgTable(
  'memory_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'personal' for personal index, otherwise a space UUID for project indexes
    indexId: text('index_id').notNull(),
    // Sprint MEM-1: sections belong to a memory_versions snapshot. Nullable
    // during backfill; new rows must set it.
    versionId: uuid('version_id').references(() => memoryVersions.id, { onDelete: 'cascade' }),
    // Stable key per section type — e.g. 'overview', 'differentiators'
    key: text('key').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndexIdx: index('memory_sections_user_index_idx').on(table.userId, table.indexId),
    sortIdx: index('memory_sections_sort_idx').on(table.indexId, table.sortOrder),
    versionIdx: index('memory_sections_version_idx').on(table.versionId, table.sortOrder),
  })
)

export type MemorySection = typeof memorySections.$inferSelect
export type NewMemorySection = typeof memorySections.$inferInsert
