/**
 * Scope Cache (Sprint SCOPE-LIVECTX-1)
 *
 * Active-scope state for each MCP/chat session.
 *
 * Durable store: `scope_sessions` table in Postgres.
 * Hot path: in-process Map keyed by sessionToken, guarded by TTL.
 *
 * The in-process layer is best-effort. On process restart, `getActiveScope`
 * transparently rehydrates from Postgres. We intentionally do not take a
 * Redis dependency here — the existing codebase treats Redis as optional,
 * and scope data is small and cheap to re-read.
 */

import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/index'
import {
  scopeDefinitions,
  scopeSessions,
  type ScopeSession,
} from '../../db/schema/scope'
import type { Boundary, Scope, ScopeMode } from './types'

// ─── In-process hot cache ────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 min — matches existing MCP session TTL

interface CacheEntry {
  scope: Scope
  sessionRowId: string
  cachedAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(sessionToken: string): string {
  return sessionToken
}

function readCache(sessionToken: string): Scope | null {
  const entry = cache.get(cacheKey(sessionToken))
  if (!entry) return null
  if (Date.now() - entry.cachedAt > SESSION_TTL_MS) {
    cache.delete(cacheKey(sessionToken))
    return null
  }
  return entry.scope
}

function writeCache(sessionToken: string, scope: Scope, sessionRowId: string): void {
  cache.set(cacheKey(sessionToken), {
    scope,
    sessionRowId,
    cachedAt: Date.now(),
  })
}

function dropCache(sessionToken: string): void {
  cache.delete(cacheKey(sessionToken))
}

// ─── Rehydrate helpers ───────────────────────────────────────────────────────

function rowToScope(row: ScopeSession, preset: { boundaries: unknown; name: string } | null): Scope {
  const boundaries =
    (row.inlineBoundaries as Boundary[] | null) ??
    ((preset?.boundaries as Boundary[] | undefined) ?? [])

  return {
    scope_id: `session_${row.id}`,
    name: preset?.name ?? 'active_scope',
    mode: row.mode as ScopeMode,
    persists_until: row.expiresAt ? row.expiresAt.toISOString() : 'session_end',
    boundaries,
    ownerId: row.userId,
    workspaceId: row.workspaceId,
    createdAt: row.activatedAt,
    updatedAt: row.activatedAt,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getActiveScope(
  sessionToken: string,
  userId: string
): Promise<Scope | null> {
  const cached = readCache(sessionToken)
  if (cached) return cached

  const rows = await db
    .select()
    .from(scopeSessions)
    .where(
      and(
        eq(scopeSessions.sessionToken, sessionToken),
        eq(scopeSessions.userId, userId),
        isNull(scopeSessions.endedAt)
      )
    )
    .orderBy(desc(scopeSessions.activatedAt))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.paused) return null

  let preset: { boundaries: unknown; name: string } | null = null
  if (row.scopeId) {
    const defs = await db
      .select({ boundaries: scopeDefinitions.boundaries, name: scopeDefinitions.name })
      .from(scopeDefinitions)
      .where(eq(scopeDefinitions.id, row.scopeId))
      .limit(1)
    preset = defs[0] ?? null
  }

  const scope = rowToScope(row, preset)
  writeCache(sessionToken, scope, row.id)
  return scope
}

export async function setActiveScope(
  sessionToken: string,
  scope: Scope,
  opts: { scopeDefinitionId?: string; expiresAt?: Date } = {}
): Promise<{ sessionRowId: string }> {
  // End any previous active session for this token.
  await db
    .update(scopeSessions)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(scopeSessions.sessionToken, sessionToken),
        isNull(scopeSessions.endedAt)
      )
    )

  const inserted = await db
    .insert(scopeSessions)
    .values({
      userId: scope.ownerId,
      workspaceId: scope.workspaceId,
      sessionToken,
      scopeId: opts.scopeDefinitionId ?? null,
      inlineBoundaries: opts.scopeDefinitionId ? null : scope.boundaries,
      mode: scope.mode,
      paused: false,
      expiresAt: opts.expiresAt ?? null,
    })
    .returning({ id: scopeSessions.id })

  const firstInserted = inserted[0]
  if (!firstInserted) throw new Error('setActiveScope: insert returned no rows')
  const sessionRowId = firstInserted.id
  writeCache(sessionToken, scope, sessionRowId)
  return { sessionRowId }
}

export async function pauseActiveScope(sessionToken: string): Promise<void> {
  await db
    .update(scopeSessions)
    .set({ paused: true })
    .where(
      and(
        eq(scopeSessions.sessionToken, sessionToken),
        isNull(scopeSessions.endedAt)
      )
    )
  dropCache(sessionToken)
}

export async function resumeActiveScope(sessionToken: string): Promise<void> {
  await db
    .update(scopeSessions)
    .set({ paused: false })
    .where(
      and(
        eq(scopeSessions.sessionToken, sessionToken),
        isNull(scopeSessions.endedAt)
      )
    )
  dropCache(sessionToken)
}

export async function endActiveScope(sessionToken: string): Promise<void> {
  await db
    .update(scopeSessions)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(scopeSessions.sessionToken, sessionToken),
        isNull(scopeSessions.endedAt)
      )
    )
  dropCache(sessionToken)
}

export async function listUserPresets(
  userId: string,
  workspaceId: string
): Promise<Array<Scope & { definitionId: string }>> {
  const rows = await db
    .select()
    .from(scopeDefinitions)
    .where(
      and(
        eq(scopeDefinitions.userId, userId),
        eq(scopeDefinitions.workspaceId, workspaceId),
        eq(scopeDefinitions.isPreset, true)
      )
    )
    .orderBy(desc(scopeDefinitions.updatedAt))

  return rows.map((r) => ({
    definitionId: r.id,
    scope_id: `preset_${r.id}`,
    name: r.name,
    mode: 'static' as ScopeMode,
    persists_until: 'manual_end' as const,
    boundaries: (r.boundaries as Boundary[]) ?? [],
    ownerId: r.userId,
    workspaceId: r.workspaceId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
}

export async function savePreset(params: {
  userId: string
  workspaceId: string
  name: string
  description?: string
  boundaries: Boundary[]
}): Promise<string> {
  const rows = await db
    .insert(scopeDefinitions)
    .values({
      userId: params.userId,
      workspaceId: params.workspaceId,
      name: params.name,
      description: params.description ?? null,
      boundaries: params.boundaries,
      isPreset: true,
    })
    .returning({ id: scopeDefinitions.id })
  const first = rows[0]
  if (!first) throw new Error('savePreset: insert returned no rows')
  return first.id
}

export async function getPresetById(id: string): Promise<{
  boundaries: Boundary[]
  name: string
  userId: string
  workspaceId: string
} | null> {
  const rows = await db
    .select()
    .from(scopeDefinitions)
    .where(eq(scopeDefinitions.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    boundaries: (row.boundaries as Boundary[]) ?? [],
    name: row.name,
    userId: row.userId,
    workspaceId: row.workspaceId,
  }
}
