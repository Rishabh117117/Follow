import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import { readFullState } from '../services/ai-state/state-reader'
import {
  updateStateSession,
  updateStatePersistent,
  defaultEventState,
  defaultSessionState,
  defaultPersistentState,
} from '../services/ai-state/state-manager'
import { db } from '../db/index'
import { aiState } from '../db/schema/ai-state'

const app = new Hono()

// GET /api/ai-state — Read current AI state for the authenticated user
app.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')
  const documentId = c.req.query('documentId')

  if (!workspaceId) {
    return c.json({ data: null, error: { code: 'INVALID', message: 'workspaceId required' } }, 400)
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const state = await readFullState(userId, workspaceId, documentId || null)
  return c.json({ data: state, error: null })
})

// POST /api/ai-state/mark-surfaced — Mark team updates as surfaced
app.post('/mark-surfaced', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { workspaceId } = body

  if (!workspaceId) {
    return c.json({ data: null, error: { code: 'INVALID', message: 'workspaceId required' } }, 400)
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  await updateStateSession(userId, workspaceId, (current) => ({
    ...current,
    newFromTeam: current.newFromTeam.map((m) => ({ ...m, surfaced: true })),
  }))

  return c.json({ data: { marked: true }, error: null })
})

// GET /api/ai-state/week-summary — Get the user's weekly work summary
app.get('/week-summary', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ data: null, error: { code: 'INVALID', message: 'workspaceId required' } }, 400)
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  // Read user's persistent state for patterns
  const state = await readFullState(userId, workspaceId)

  // Query cross-document episodes from the index
  const { executeIndexQuery } = await import('../services/semantic-index/query-executor')
  const indexResult = await executeIndexQuery({
    workspaceId,
    userId,
    weightProfile: 'history',
    limit: 100,
    includeEpisodes: true,
    timeRangeMinutes: 7 * 24 * 60,
  })

  // Build document summary from episodes
  const docMap = new Map<string, { title: string; episodeCount: number; eventCount: number }>()
  for (const result of indexResult.results) {
    const docId = result.documentId
    if (!docId) continue
    const existing = docMap.get(docId) || {
      title: result.documentTitle || 'Untitled',
      episodeCount: 0,
      eventCount: 0,
    }
    existing.eventCount++
    docMap.set(docId, existing)
  }

  // Count unique episodes per document
  for (const [epId] of Object.entries(indexResult.episodes || {})) {
    const events = indexResult.results.filter((r) => r.episodeId === epId)
    if (events.length > 0 && events[0]!.documentId) {
      const doc = docMap.get(events[0]!.documentId)
      if (doc) doc.episodeCount++
    }
  }

  const stateShape = state as { persistent?: { patterns?: unknown } | null; session?: unknown }
  return c.json({
    data: {
      patterns: stateShape.persistent?.patterns || null,
      session: stateShape.session || null,
      documentsWorkedOn: [...docMap.entries()]
        .map(([id, data]) => ({ documentId: id, ...data }))
        .sort((a, b) => b.episodeCount - a.episodeCount),
      totalEpisodes: Object.keys(indexResult.episodes || {}).length,
      totalEvents: indexResult.results.length,
    },
    error: null,
  })
})

// DELETE /api/ai-state/knowledge/:factIndex — remove one fact from longTermKnowledge
app.delete('/knowledge/:factIndex', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')
  const factIndex = parseInt(c.req.param('factIndex'), 10)

  if (!workspaceId) {
    return c.json({ data: null, error: { code: 'INVALID', message: 'workspaceId required' } }, 400)
  }
  if (Number.isNaN(factIndex) || factIndex < 0) {
    return c.json({ data: null, error: { code: 'INVALID', message: 'invalid factIndex' } }, 400)
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  await updateStatePersistent(userId, workspaceId, (current) => {
    const raw = current as unknown as Record<string, unknown>
    const knowledge = Array.isArray(raw['longTermKnowledge'])
      ? (raw['longTermKnowledge'] as unknown[])
      : []
    const next = knowledge.filter((_, i) => i !== factIndex)
    return { ...current, longTermKnowledge: next } as typeof current
  })

  return c.json({ data: { ok: true }, error: null })
})

// PATCH /api/ai-state/knowledge — correct, remove, or edit a fact in longTermKnowledge
app.patch('/knowledge', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    workspaceId: string
    action: 'correct' | 'remove' | 'edit'
    factId: string
    newText?: string
    // E-3.3: optional documentId for shared-pool propagation
    documentId?: string
  }>()

  if (!body.workspaceId || !body.action || !body.factId) {
    return c.json(
      { data: null, error: { code: 'INVALID', message: 'workspaceId, action, factId required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, body.workspaceId)
  if (denied) return denied

  // Capture the original fact text so we can propagate to the shared pool.
  let originalFactText: string | undefined

  await updateStatePersistent(userId, body.workspaceId, (current) => {
    const raw = current as unknown as Record<string, unknown>
    const knowledge = Array.isArray(raw['longTermKnowledge'])
      ? ([...raw['longTermKnowledge']] as Array<Record<string, unknown>>)
      : []
    const exclusions = Array.isArray(raw['knowledgeExclusions'])
      ? ([...raw['knowledgeExclusions']] as Array<Record<string, unknown>>)
      : []

    const idx = knowledge.findIndex(
      (f) => f && (f['id'] === body.factId || f['fact'] === body.factId)
    )

    if (idx >= 0) {
      const existing = knowledge[idx]!
      originalFactText =
        typeof existing['fact'] === 'string' ? (existing['fact'] as string) : undefined
      if (body.action === 'remove') {
        exclusions.push({ ...existing, removedAt: new Date().toISOString() })
        knowledge.splice(idx, 1)
      } else if (body.action === 'correct') {
        knowledge[idx] = { ...existing, confidence: 1.0, confirmedAt: new Date().toISOString() }
      } else if (body.action === 'edit' && body.newText) {
        knowledge[idx] = { ...existing, fact: body.newText, editedAt: new Date().toISOString() }
      }
    }

    return {
      ...current,
      longTermKnowledge: knowledge,
      knowledgeExclusions: exclusions,
    } as unknown as typeof current
  })

  // E-3.3: If the fact also lives in the document's shared knowledge pool,
  // propagate the same action there so teammates see the correction.
  let sharedPropagated = false
  if (body.documentId && originalFactText) {
    try {
      const { updateSharedState } = await import('../services/ai-state/state-manager')
      await updateSharedState(body.documentId, body.workspaceId, (current) => {
        const updated = { ...current }
        const list = (updated.knowledge || []) as Array<Record<string, unknown>>
        const matchIdx = list.findIndex((k) => k.id === body.factId || k.fact === originalFactText)
        if (matchIdx < 0) return updated
        sharedPropagated = true
        if (body.action === 'remove') {
          list.splice(matchIdx, 1)
        } else if (body.action === 'correct') {
          list[matchIdx] = {
            ...list[matchIdx],
            confidence: 1.0,
            confirmedAt: new Date().toISOString(),
          }
        } else if (body.action === 'edit' && body.newText) {
          list[matchIdx] = {
            ...list[matchIdx],
            fact: body.newText,
            editedAt: new Date().toISOString(),
          }
        }
        updated.knowledge = list as typeof updated.knowledge
        return updated
      })
    } catch (err) {
      console.warn('[ai-state] shared propagation failed:', (err as Error).message)
    }
  }

  return c.json({ data: { ok: true, sharedPropagated }, error: null })
})

// DELETE /api/ai-state — clear all 3 state layers for the user
app.delete('/', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ data: null, error: { code: 'INVALID', message: 'workspaceId required' } }, 400)
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  await db
    .update(aiState)
    .set({
      stateEvent: defaultEventState(),
      stateSession: defaultSessionState(),
      statePersistent: defaultPersistentState(),
      version: 1,
    })
    .where(and(eq(aiState.userId, userId), eq(aiState.workspaceId, workspaceId)))

  return c.json({ data: { ok: true }, error: null })
})

export { app as aiStateRouter }
