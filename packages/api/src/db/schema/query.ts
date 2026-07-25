/**
 * Saved Queries Schema (Sprint V41-QUERY-1)
 *
 * A user-saved StructuredQuery — a composition of Boundary[] + select spec +
 * optional aggregations. The Query ability's persistent counterpart to
 * ad-hoc structured runs. Boundaries reuse the SCOPE-LIVECTX-1 model.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'

export const savedQueries = pgTable(
  'saved_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    name: text('name').notNull(),
    description: text('description'),

    // Boundary[] — see services/scope/types.ts
    boundaries: jsonb('boundaries').notNull(),

    // { fields: string[], limit, offset, orderBy, groupBy }
    selectSpec: jsonb('select_spec').notNull(),

    // Aggregation[] or null
    aggregations: jsonb('aggregations'),

    isPinned: boolean('is_pinned').notNull().default(false),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    runCount: integer('run_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userWorkspaceIdx: index('saved_queries_user_workspace_idx').on(t.userId, t.workspaceId),
    pinnedIdx: index('saved_queries_pinned_idx').on(t.workspaceId, t.isPinned),
  })
)

export type SavedQuery = typeof savedQueries.$inferSelect
export type NewSavedQuery = typeof savedQueries.$inferInsert
