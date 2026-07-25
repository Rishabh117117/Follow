/**
 * MCP active-project routing (2026-04-30)
 *
 * One row per (userId, workspaceId) recording which project the user is
 * currently writing INTO via MCP. Read by `transport.getOrCreateSession()`
 * on every fresh MCP connection so a server restart doesn't silently drop
 * the user back to personal. Written by the `set_scope` tool.
 *
 * Distinct from `scope_sessions` — that table drives the *read-side* context
 * filter (boundaries, mode, paused). This one drives where save_conversation
 * / contribute land. Conflating the two would couple two unrelated lifecycles
 * (scope can be paused/expired; active-project shouldn't be).
 *
 * `active_project_id IS NULL` means "personal" — no project routing.
 */

import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core'

export const mcpActiveProject = pgTable(
  'mcp_active_project',
  {
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    activeProjectId: uuid('active_project_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.workspaceId] }),
  })
)

export type McpActiveProject = typeof mcpActiveProject.$inferSelect
export type NewMcpActiveProject = typeof mcpActiveProject.$inferInsert
