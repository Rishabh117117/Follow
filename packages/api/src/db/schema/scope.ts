/**
 * Scope Formalization Schema (Sprint SCOPE-LIVECTX-1)
 *
 * Three tables backing user-decided boundary-based scoping:
 *
 * - `scope_definitions`: saved boundary compositions (presets) a user can reuse.
 * - `scope_sessions`: the active scope per MCP/chat session, with TTL + pause state.
 * - `scope_conflicts`: audit trail of conflicts surfaced by the conflict resolver.
 *
 * Governance invariant: scope never rewrites ground truth in `thread_events`;
 * it's strictly a filter applied at retrieval time. Governance-vs-boundary
 * conflicts route to `request_access` resolution, never silent downgrade.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'

// ─── SCOPE DEFINITIONS (saved presets) ────────────────────────────────────────

export const scopeDefinitions = pgTable(
  'scope_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    name: text('name').notNull(),
    description: text('description'),

    // Boundary[] — see services/scope/types.ts
    boundaries: jsonb('boundaries').notNull(),

    // true = reusable preset surfaced in the UI preset list.
    // false = transient saved definition (e.g., auto-saved snapshot).
    isPreset: boolean('is_preset').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userWorkspaceIdx: index('scope_definitions_user_workspace_idx').on(t.userId, t.workspaceId),
  })
)

// ─── SCOPE SESSIONS (active scope per session, with TTL) ──────────────────────

export const scopeSessions = pgTable(
  'scope_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    // Chat thread id OR MCP session token — whatever owns this active scope.
    sessionToken: text('session_token'),

    // If the scope was activated from a saved preset, this FKs scope_definitions.id.
    // If ad-hoc (inline boundaries only), this is null.
    scopeId: uuid('scope_id'),

    // Boundary[] — set when scope is ad-hoc (no preset). May also be present
    // alongside scopeId if the user adjusted a preset for this session.
    inlineBoundaries: jsonb('inline_boundaries'),

    mode: text('mode').$type<'live' | 'static'>().notNull().default('static'),
    paused: boolean('paused').notNull().default(false),

    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
    // null = persist until session_end (no hard TTL). Else hard TTL.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => ({
    userWorkspaceIdx: index('scope_sessions_user_workspace_idx').on(t.userId, t.workspaceId),
    sessionTokenIdx: index('scope_sessions_session_token_idx').on(t.sessionToken),
  })
)

// ─── SCOPE CONFLICTS (audit log) ──────────────────────────────────────────────

export const scopeConflicts = pgTable(
  'scope_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    // FK-ish pointer to scope_sessions.id; nullable for preview/validate paths.
    sessionId: uuid('session_id'),

    conflictType: text('conflict_type')
      .$type<'within_scope' | 'vs_governance' | 'cross_user'>()
      .notNull(),

    // Full ScopeConflict object (boundaries involved, governance rule, resolution).
    payload: jsonb('payload').notNull(),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionAction: text('resolution_action'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userWorkspaceIdx: index('scope_conflicts_user_workspace_idx').on(t.userId, t.workspaceId),
  })
)

export type ScopeDefinition = typeof scopeDefinitions.$inferSelect
export type NewScopeDefinition = typeof scopeDefinitions.$inferInsert
export type ScopeSession = typeof scopeSessions.$inferSelect
export type NewScopeSession = typeof scopeSessions.$inferInsert
export type ScopeConflictRow = typeof scopeConflicts.$inferSelect
export type NewScopeConflictRow = typeof scopeConflicts.$inferInsert
