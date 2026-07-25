/**
 * Sessions (2026-04-29)
 *
 * Unified session lifecycle for both MCP and webapp surfaces. Powers the
 * session-bracketed Archivist + Profiler triggers from the v5.2 pipeline
 * (see config/model-tier-prompts.ts → PIPELINE_ROLES).
 *
 * Lifecycle
 *   - MCP: opened on first SSE connection or set_scope({live_capture:true}).
 *     Heartbeat = every tool call. Closed on SSE disconnect or 20-min idle.
 *   - Webapp: opened on auth + tab open. Heartbeat = every 60s from client.
 *     Closed on tab close (sendBeacon) or 20-min idle.
 *
 * The idle reaper (services/sessions/index.ts) runs every minute and closes
 * any session whose lastHeartbeatAt < now - 20min, marking endReason as
 * 'idle_timeout'. This is what the Archivist's session_end trigger fires on.
 */

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { workspaces } from './workspaces'

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    // 'mcp' | 'webapp'
    surface: varchar('surface', { length: 16 }).notNull(),

    // For MCP, the SSE connection id; for webapp, the browser tab uuid.
    // Lets a single user have concurrent sessions across surfaces without
    // the lifecycle hooks colliding.
    surfaceClientId: varchar('surface_client_id', { length: 128 }),

    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    // 'explicit' | 'disconnect' | 'idle_timeout' | 'replaced' | null
    endReason: varchar('end_reason', { length: 32 }),

    // Updated by webapp every 60s and by MCP on every tool call. The idle
    // reaper compares this to now() - 20min.
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Frozen scope at session start. Lets the Profiler reason about what
    // the user was scoped to when patterns were detected.
    scopeSnapshot: jsonb('scope_snapshot').$type<{
      indexes?: string[]
      contributors?: string[]
      tags?: string[]
      timeWindow?: { start: string; end: string }
    } | null>(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  },
  (t) => ({
    // Find a user's active sessions in O(1)
    userActiveIdx: index('sessions_user_active_idx').on(t.userId, t.endedAt),
    surfaceIdx: index('sessions_surface_idx').on(t.surface),
    // Idle reaper scan
    heartbeatActiveIdx: index('sessions_heartbeat_active_idx').on(
      t.lastHeartbeatAt,
      t.endedAt
    ),
  })
)

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
