/**
 * Google Workspace API routes — mounted at /api/gws
 *
 * Sprint G2 — Smart Document Activation
 * Sprint G6 — Strand Association
 * Sprint G7 — Thread Events, Stats, Addon Actions
 * Sprint G8 — Unified Activity Feed
 *
 * Handles:
 * - POST   /documents           — Activate a Smart Document
 * - GET    /documents/:id       — Get Smart Document status
 * - DELETE /documents/:id       — Deactivate Smart Document
 * - POST   /documents/:id/signals — Ingest signal batch from extension
 * - GET    /documents/:id/threads — Get threads for this document
 * - POST   /documents/:id/content — Store document content snapshot
 * - PATCH  /documents/:id/strand  — Update strand association (G6)
 * - GET    /documents/:id/threads/:threadId/events — Thread events (G7)
 * - GET    /documents/:id/stats — Document activity stats (G7)
 * - GET    /documents/:id/addon-actions — Poll addon actions (G7)
 * - DELETE /documents/:id/addon-actions — Clear addon action (G7)
 * - GET    /strands/:strandId/activity — Unified activity feed (G8)
 */

import { Hono } from 'hono'
import { db } from '../db'
import { externalDocuments } from '../db/schema/external-documents'
import { strands, threads, threadEvents, strandThreadRefs } from '../db/schema/threads'
import { users } from '../db/schema/users'
import { workspaces, workspaceMembers } from '../db/schema/workspaces'
import { eq, and, desc, lt, gt, inArray, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import { insertSignals } from '../services/signals'

/**
 * Ensure workspace + user exist in PGlite (they may be lost after restart).
 * No-op if they already exist.
 */
export async function ensureWorkspaceExists(workspaceId: string, userId: string): Promise<void> {
  // Check if workspace exists
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
  if (ws) return

  // Ensure user exists (insert if missing)
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!existingUser) {
    await db
      .insert(users)
      .values({
        id: userId,
        email: `user-${userId.slice(0, 8)}@follow.app`,
        name: 'Follow User',
      })
      .onConflictDoNothing()
  }

  // Create workspace
  await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: 'My Workspace',
      slug: `ws-${workspaceId.slice(0, 8)}`,
      ownerId: userId,
    })
    .onConflictDoNothing()

  // Add membership
  await db
    .insert(workspaceMembers)
    .values({
      workspaceId,
      userId,
      role: 'admin',
    })
    .onConflictDoNothing()
}

export const gwsRouter = new Hono()

// All GWS routes require authentication
gwsRouter.use('*', authMiddleware)

// ─── GET /documents — List all active Smart Documents ─────────────────────

gwsRouter.get('/documents', async (c) => {
  const workspaceId = c.get('workspaceId') as string
  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied
  const filter = c.req.query('filter') // 'tracked' | 'recent' | 'all' (default: 'all')

  try {
    const conditions = [eq(externalDocuments.workspaceId, workspaceId)]

    if (filter === 'tracked') {
      conditions.push(eq(externalDocuments.isActive, true))
    } else if (filter === 'recent') {
      conditions.push(eq(externalDocuments.isActive, false))
    }
    // 'all' or no filter: return everything

    const docs = await db
      .select()
      .from(externalDocuments)
      .where(and(...conditions))
      .orderBy(desc(externalDocuments.updatedAt))

    return c.json({
      data: docs.map((d) => ({
        id: d.id,
        externalDocId: d.externalDocId,
        docType: d.docType,
        title: d.title,
        isActive: d.isActive,
        strandId: d.strandId,
        activatedAt: d.activatedAt,
        updatedAt: d.updatedAt,
      })),
      error: null,
    })
  } catch (err) {
    console.error('[GWS] List documents failed:', err)
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list documents' } },
      500
    )
  }
})

// ─── POST /documents — Activate a Smart Document ─────────────────────────

gwsRouter.post('/documents', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json<{
    externalDocId: string
    docType: 'google_docs' | 'google_sheets' | 'google_slides'
    title: string
    workspaceId: string
    strandId?: string
  }>()

  const { externalDocId, docType, title, strandId } = body
  // Prefer workspace ID from auth header (always correct), fall back to body
  const workspaceId = (c.get('workspaceId') as string) || body.workspaceId

  console.info(
    '[GWS POST /documents] userId:',
    userId,
    'headerWsId:',
    c.get('workspaceId'),
    'bodyWsId:',
    body.workspaceId,
    'resolvedWsId:',
    workspaceId,
    'docId:',
    externalDocId,
    'title:',
    title
  )

  if (!externalDocId || !docType || !title || !workspaceId) {
    console.info('[GWS POST /documents] REJECTED — missing fields. workspaceId:', workspaceId)
    return c.json({ error: { message: 'Missing required fields' } }, 400)
  }

  // SPECIAL CASE: ensureWorkspaceExists below auto-creates the workspace and
  // makes the caller its admin, so a caller using their OWN (not-yet-seeded)
  // workspace is legitimate. Only guard when the workspace ALREADY exists —
  // then the caller must be its owner/member, and a stranger naming someone
  // else's workspace is rejected. If it doesn't exist yet, fall through to the
  // auto-create path for this caller.
  const [existingWs] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
  if (existingWs) {
    const denied = await assertWorkspaceAccess(c, workspaceId)
    if (denied) return denied
  }

  // Ensure workspace exists (PGlite loses data on restart)
  await ensureWorkspaceExists(workspaceId, userId)

  // Check if already active (possibly by another user)
  const existing = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    const doc = existing[0]!
    // If same user, return existing
    if (doc.userId === userId) {
      return c.json({ data: doc })
    }
    // Different user — join the existing strand as collaborator
    if (doc.strandId) {
      const { joinDocumentStrand } = await import('../services/document-strand-manager')
      const result = await joinDocumentStrand(workspaceId, userId, doc.id, doc.strandId)
      return c.json({
        data: {
          ...doc,
          _multiUser: true,
          _userThreads: result.threads,
        },
      })
    }
    return c.json({ data: doc })
  }

  // Create strand if none provided
  let resolvedStrandId = strandId
  if (!resolvedStrandId) {
    const [newStrand] = await db
      .insert(strands)
      .values({
        workspaceId,
        ownerId: userId,
        name: `Smart Doc: ${title}`,
        color: '#6366F1',
      })
      .returning()
    resolvedStrandId = newStrand!.id
  }

  // Insert external document record
  const [doc] = await db
    .insert(externalDocuments)
    .values({
      workspaceId,
      userId,
      externalDocId,
      docType,
      title,
      strandId: resolvedStrandId,
      metadata: {
        lastKnownTitle: title,
        collaboratorCount: 0,
        signalCount: 0,
      },
    })
    .returning()

  return c.json({ data: doc })
})

// ─── GET /documents/:externalDocId — Get Smart Document status ───────────

gwsRouter.get('/documents/:externalDocId', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const results = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  return c.json({ data: results[0] ?? null })
})

// ─── DELETE /documents/:externalDocId — Deactivate Smart Document ────────

gwsRouter.delete('/documents/:externalDocId', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  await db
    .update(externalDocuments)
    .set({
      isActive: false,
      deactivatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )

  return c.json({ data: { success: true } })
})

// ─── POST /documents/:externalDocId/signals — Ingest signal batch ────────

gwsRouter.post('/documents/:externalDocId/signals', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string
  const userId = c.get('userId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const body = await c.req.json<{
    signals: Array<{
      signalType: string
      payload: Record<string, unknown>
      timestamp: string
    }>
  }>()

  if (!body.signals || !Array.isArray(body.signals)) {
    return c.json({ error: { message: 'Invalid signals array' } }, 400)
  }

  // Transform signals into insertSignals() format (camelCase keys)
  // Use per-user session ID for multi-user signal separation
  const clickhouseSignals = body.signals.map((signal) => ({
    signalType: signal.signalType,
    sessionId: `gws-${externalDocId}-${userId}`,
    workspaceId,
    userId,
    timestamp: new Date(signal.timestamp),
    url: `https://docs.google.com/document/d/${externalDocId}`,
    domain: 'docs.google.com',
    title: (signal.payload?.title as string) ?? '',
    metadata: {
      ...signal.payload,
      source: 'gws_extension',
      externalDocId,
    } as Record<string, unknown>,
  }))

  // Insert into ClickHouse
  try {
    await insertSignals(clickhouseSignals)
  } catch (err) {
    console.error('[GWS] Failed to insert signals:', err)
    // Don't fail the request — signals are best-effort
  }

  // Merge signal count into existing metadata (preserve other fields)
  const [existingDoc] = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (existingDoc) {
    const existingMeta = (existingDoc.metadata || {}) as Record<string, unknown>
    await db
      .update(externalDocuments)
      .set({
        metadata: {
          ...existingMeta,
          signalCount: ((existingMeta.signalCount as number) || 0) + body.signals.length,
          lastSignalAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(externalDocuments.id, existingDoc.id))
  }

  return c.json({ data: { received: body.signals.length } })
})

// ─── GET /documents/:externalDocId/threads — Get threads ─────────────────

gwsRouter.get('/documents/:externalDocId/threads', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  // First get the Follow document
  const docs = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (docs.length === 0) {
    return c.json({ data: [] })
  }

  const followDocId = docs[0]!.id
  const strandId = docs[0]!.strandId

  // If the document has a strand, get threads through strand→thread refs
  if (strandId) {
    const refs = await db
      .select()
      .from(strandThreadRefs)
      .where(eq(strandThreadRefs.strandId, strandId))

    const threadIds = refs.map((r) => r.threadId)
    if (threadIds.length > 0) {
      const strandThreads = await db.select().from(threads).where(inArray(threads.id, threadIds))

      // Annotate threads with source info
      const annotated = strandThreads.map((t) => ({
        ...t,
        source: (t.metadata as Record<string, unknown>)?.externalDocumentId
          ? 'google_workspace'
          : 'native',
      }))

      return c.json({ data: annotated })
    }
  }

  // Also look for threads that reference this external document via metadata
  const metaThreads = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.workspaceId, workspaceId),
        sql`metadata->>'externalDocumentId' = ${followDocId}`
      )
    )

  return c.json({
    data: metaThreads.map((t) => ({
      ...t,
      source: 'google_workspace',
    })),
  })
})

// ─── POST /documents/:externalDocId/content — Store content snapshot ─────

gwsRouter.post('/documents/:externalDocId/content', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const body = await c.req.json<{
    content: string
    revisionId: string
    docType?: 'docs' | 'sheets' | 'slides'
    sheetName?: string
    slideIndex?: number
    paragraphCount?: number
  }>()

  // Merge content snapshot into existing metadata (don't overwrite signalCount, etc.)
  const [existingDoc] = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (existingDoc) {
    const existingMeta = (existingDoc.metadata || {}) as Record<string, unknown>
    await db
      .update(externalDocuments)
      .set({
        lastSyncRevision: body.revisionId,
        metadata: {
          ...existingMeta,
          lastContentSnapshot: body.content.slice(0, 10000),
          // E-1.4: preserve doc-type-specific context so buildGWSDocumentContext
          // can pick the sheet/slide builder.
          lastSnapshotDocType: body.docType,
          lastSheetName: body.sheetName,
          lastSlideIndex: body.slideIndex,
          lastParagraphCount: body.paragraphCount,
          lastSnapshotAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(externalDocuments.id, existingDoc.id))

    // Sprint IX-9: also write a versioned snapshot to gws_snapshots.
    // This piggybacks on the extension's existing 5-min content sync so
    // the periodic-snapshot trigger requires no extension change. Dedup
    // is handled by captureGwsSnapshot via content-hash comparison.
    try {
      const userId = c.get('userId') as string
      const { captureGwsSnapshot, normalizeDocType } =
        await import('../services/gws/snapshot-capture')
      await captureGwsSnapshot({
        workspaceId,
        userId,
        externalDocId,
        docType: normalizeDocType(body.docType),
        content: body.content,
        title: (existingMeta.lastKnownTitle as string) ?? undefined,
        triggerType: 'periodic',
        metadata: {
          revisionId: body.revisionId,
          paragraphCount: body.paragraphCount,
          sheetName: body.sheetName,
          slideIndex: body.slideIndex,
        },
      })
    } catch (err) {
      // Non-blocking — snapshot failure must never break the content-sync path
      console.warn('[GWS] Versioned snapshot capture failed (non-fatal):', err)
    }
  }

  return c.json({ data: { success: true } })
})

// ─── PATCH /documents/:externalDocId/strand — Update strand association (G6) ──

gwsRouter.patch('/documents/:externalDocId/strand', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const body = await c.req.json<{ strandId: string }>()

  if (!body.strandId) {
    return c.json({ error: { message: 'strandId is required' } }, 400)
  }

  // Verify the strand exists and belongs to this workspace
  const [strand] = await db
    .select()
    .from(strands)
    .where(and(eq(strands.id, body.strandId), eq(strands.workspaceId, workspaceId)))

  if (!strand) {
    return c.json({ error: { message: 'Strand not found' } }, 404)
  }

  // Update external document strand reference
  const [updated] = await db
    .update(externalDocuments)
    .set({
      strandId: body.strandId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .returning()

  if (!updated) {
    return c.json({ error: { message: 'Document not found' } }, 404)
  }

  // If the document has threads, update their strandThreadRefs
  const docThreads = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.workspaceId, workspaceId),
        sql`metadata->>'externalDocumentId' = ${updated.id}`
      )
    )

  const userId = c.get('userId') as string
  for (const thread of docThreads) {
    // Upsert strand-thread ref
    await db
      .insert(strandThreadRefs)
      .values({
        strandId: body.strandId,
        threadId: thread.id,
        addedBy: userId,
      })
      .onConflictDoNothing()
  }

  return c.json({ data: updated })
})

// ─── GET /documents/:externalDocId/threads/:threadId/events — Thread events (G7) ──

gwsRouter.get('/documents/:externalDocId/threads/:threadId/events', async (c) => {
  const threadId = c.req.param('threadId')
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500)
  const before = c.req.query('before') // ISO timestamp cursor
  const after = c.req.query('after') // ISO timestamp cursor

  const [thread] = await db
    .select({ workspaceId: threads.workspaceId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1)
  if (!thread) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Thread not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, thread.workspaceId)
  if (denied) return denied

  let query = db
    .select()
    .from(threadEvents)
    .where(eq(threadEvents.threadId, threadId))
    .orderBy(desc(threadEvents.time))
    .limit(limit)

  // Apply cursor filters if provided
  if (before) {
    query = db
      .select()
      .from(threadEvents)
      .where(and(eq(threadEvents.threadId, threadId), lt(threadEvents.time, new Date(before))))
      .orderBy(desc(threadEvents.time))
      .limit(limit)
  } else if (after) {
    query = db
      .select()
      .from(threadEvents)
      .where(and(eq(threadEvents.threadId, threadId), gt(threadEvents.time, new Date(after))))
      .orderBy(desc(threadEvents.time))
      .limit(limit)
  }

  const events = await query

  return c.json({
    data: events,
    pagination: {
      hasMore: events.length === limit,
      nextCursor: events.length > 0 ? events[events.length - 1]!.time.toISOString() : null,
    },
  })
})

// ─── GET /documents/:externalDocId/stats — Document activity stats (G7) ──

gwsRouter.get('/documents/:externalDocId/stats', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  // Get the Follow document
  const docs = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (docs.length === 0) {
    return c.json({
      data: {
        editCount: 0,
        aiInteractionCount: 0,
        keyChangeCount: 0,
        browserEventCount: 0,
        collaboratorCount: 0,
      },
    })
  }

  const followDoc = docs[0]!
  const strandId = followDoc.strandId

  if (!strandId) {
    return c.json({
      data: {
        editCount: 0,
        aiInteractionCount: 0,
        keyChangeCount: 0,
        browserEventCount: 0,
        collaboratorCount: followDoc.metadata?.collaboratorCount ?? 0,
      },
    })
  }

  // Get all threads in the strand
  const refs = await db
    .select()
    .from(strandThreadRefs)
    .where(eq(strandThreadRefs.strandId, strandId))

  const threadIds = refs.map((r) => r.threadId)
  if (threadIds.length === 0) {
    return c.json({
      data: {
        editCount: 0,
        aiInteractionCount: 0,
        keyChangeCount: 0,
        browserEventCount: 0,
        collaboratorCount: followDoc.metadata?.collaboratorCount ?? 0,
      },
    })
  }

  // Get all threads to categorize
  const strandThreads = await db.select().from(threads).where(inArray(threads.id, threadIds))

  const docThreadIds = strandThreads.filter((t) => t.type === 'doc').map((t) => t.id)
  const aiThreadIds = strandThreads.filter((t) => t.type === 'ai').map((t) => t.id)
  const browserThreadIds = strandThreads.filter((t) => t.type === 'browser').map((t) => t.id)

  // Count events by category
  const countEvents = async (ids: string[]) => {
    if (ids.length === 0) return 0
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(threadEvents)
      .where(inArray(threadEvents.threadId, ids))
    return result[0]?.count ?? 0
  }

  const countKeyChanges = async () => {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(threadEvents)
      .where(and(inArray(threadEvents.threadId, threadIds), eq(threadEvents.keyChange, true)))
    return result[0]?.count ?? 0
  }

  const [editCount, aiInteractionCount, browserEventCount, keyChangeCount] = await Promise.all([
    countEvents(docThreadIds),
    countEvents(aiThreadIds),
    countEvents(browserThreadIds),
    countKeyChanges(),
  ])

  return c.json({
    data: {
      editCount,
      aiInteractionCount,
      keyChangeCount,
      browserEventCount,
      collaboratorCount: followDoc.metadata?.collaboratorCount ?? 0,
    },
  })
})

// ─── GET /documents/:externalDocId/addon-actions — Poll addon actions (G7) ──

gwsRouter.get('/documents/:externalDocId/addon-actions', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const docs = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (docs.length === 0) {
    return c.json({ action: null })
  }

  const metadata = docs[0]!.metadata as Record<string, unknown> | null
  const pendingAction = metadata?.pendingAction as string | undefined
  const pendingActions = (metadata?.pendingActions ?? []) as Array<Record<string, unknown>>

  return c.json({
    action: pendingAction ?? null,
    actionTs: metadata?.pendingActionTs ?? null,
    pendingActions: pendingActions.filter((a) => a.status === 'pending'),
  })
})

// ─── POST /documents/:externalDocId/addon-actions — Queue addon action (E-2) ──
//
// Used by the GWS extension insertion service as its Apps Script fallback.
// Stores a new action in metadata.pendingActions with a generated actionId
// and initial status 'pending'. The Apps Script add-on polls via the
// existing GET endpoint and writes back the result via the companion
// POST /:actionId/status endpoint below.

gwsRouter.post('/documents/:externalDocId/addon-actions', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const body = await c.req.json<{
    action: {
      type: 'INSERT_AFTER_PARAGRAPH' | 'REPLACE_TEXT_RANGE' | string
      content?: string
      paragraphIndex?: number
      startIndex?: number
      endIndex?: number
      timestamp?: number
    }
  }>()

  if (!body?.action?.type) {
    return c.json({ error: { message: 'action.type is required' } }, 400)
  }

  const [doc] = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (!doc) {
    return c.json({ error: { message: 'Document not found' } }, 404)
  }

  const actionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const existing = (doc.metadata || {}) as Record<string, unknown>
  const pending = (existing.pendingActions ?? []) as Array<Record<string, unknown>>

  const queuedAction = {
    id: actionId,
    ...body.action,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }

  await db
    .update(externalDocuments)
    .set({
      metadata: {
        ...existing,
        pendingActions: [...pending, queuedAction],
      } as (typeof externalDocuments.$inferInsert)['metadata'],
      updatedAt: new Date(),
    })
    .where(eq(externalDocuments.id, doc.id))

  return c.json({ data: { queued: true, actionId } })
})

// ─── GET /documents/:externalDocId/addon-actions/:actionId — Status (E-2) ──

gwsRouter.get('/documents/:externalDocId/addon-actions/:actionId', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const actionId = c.req.param('actionId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const [doc] = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (!doc) {
    return c.json({ error: { message: 'Document not found' } }, 404)
  }

  const meta = (doc.metadata || {}) as Record<string, unknown>
  const all = (meta.pendingActions ?? []) as Array<Record<string, unknown>>
  const action = all.find((a) => a.id === actionId)

  if (!action) {
    // Action may have been garbage-collected after completion — treat as completed success
    return c.json({
      data: { completed: true, success: true, failed: false, status: 'completed' },
    })
  }

  const status = action.status as string
  return c.json({
    data: {
      completed: status === 'completed',
      failed: status === 'failed',
      success: status === 'completed',
      error: action.error as string | undefined,
      status,
    },
  })
})

// ─── POST /documents/:externalDocId/addon-actions/:actionId/status — (E-2) ──
//
// Called by the Apps Script add-on after it executes an action, to mark it
// completed or failed. Once the client observes the terminal state, the
// action can be cleared with the existing DELETE endpoint.

gwsRouter.post('/documents/:externalDocId/addon-actions/:actionId/status', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const actionId = c.req.param('actionId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const body = await c.req.json<{
    status: 'processing' | 'completed' | 'failed'
    error?: string
  }>()

  const [doc] = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (!doc) {
    return c.json({ error: { message: 'Document not found' } }, 404)
  }

  const meta = (doc.metadata || {}) as Record<string, unknown>
  const all = (meta.pendingActions ?? []) as Array<Record<string, unknown>>
  const updated = all.map((a) =>
    a.id === actionId
      ? { ...a, status: body.status, error: body.error, updatedAt: new Date().toISOString() }
      : a
  )

  await db
    .update(externalDocuments)
    .set({
      metadata: {
        ...meta,
        pendingActions: updated,
      } as (typeof externalDocuments.$inferInsert)['metadata'],
      updatedAt: new Date(),
    })
    .where(eq(externalDocuments.id, doc.id))

  return c.json({ data: { success: true } })
})

// ─── DELETE /documents/:externalDocId/addon-actions — Clear addon action (G7) ──

gwsRouter.delete('/documents/:externalDocId/addon-actions', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const docs = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (docs.length > 0) {
    const existing = (docs[0]!.metadata ?? {}) as Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional: destructure-and-omit; rest is used below, the 3 named keys are intentionally dropped
    const { pendingAction: _a, pendingActionTs: _b, pendingActions: _c, ...rest } = existing
    await db
      .update(externalDocuments)
      .set({
        metadata: rest as (typeof externalDocuments.$inferInsert)['metadata'],
        updatedAt: new Date(),
      })
      .where(eq(externalDocuments.id, docs[0]!.id))
  }

  return c.json({ data: { success: true } })
})

// ─── GET /strands/:strandId/activity — Unified activity feed (G8) ────────

gwsRouter.get('/strands/:strandId/activity', async (c) => {
  const strandId = c.req.param('strandId')
  const workspaceId = c.get('workspaceId') as string
  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200)
  const before = c.req.query('before') // ISO timestamp cursor

  // Verify strand belongs to workspace
  const [strand] = await db
    .select()
    .from(strands)
    .where(and(eq(strands.id, strandId), eq(strands.workspaceId, workspaceId)))

  if (!strand) {
    return c.json({ error: { message: 'Strand not found' } }, 404)
  }

  // Get all threads in the strand
  const refs = await db
    .select()
    .from(strandThreadRefs)
    .where(eq(strandThreadRefs.strandId, strandId))

  const threadIds = refs.map((r) => r.threadId)
  if (threadIds.length === 0) {
    return c.json({ data: [], pagination: { hasMore: false, nextCursor: null } })
  }

  // Get thread details for source annotation
  const strandThreads = await db.select().from(threads).where(inArray(threads.id, threadIds))

  const threadMap = new Map(strandThreads.map((t) => [t.id, t]))

  // Get external documents linked to the strand for source tags
  const externalDocs = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.strandId, strandId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )

  const externalDocMap = new Map(externalDocs.map((d) => [d.id, d]))

  // Fetch merged events from all threads
  const whereClause = before
    ? and(inArray(threadEvents.threadId, threadIds), lt(threadEvents.time, new Date(before)))
    : inArray(threadEvents.threadId, threadIds)

  const events = await db
    .select()
    .from(threadEvents)
    .where(whereClause)
    .orderBy(desc(threadEvents.time))
    .limit(limit)

  // Annotate each event with source and document info
  const annotated = events.map((event) => {
    const thread = threadMap.get(event.threadId)
    const threadMeta = (thread?.metadata ?? {}) as Record<string, unknown>
    const externalDocumentId = threadMeta.externalDocumentId as string | undefined
    const externalDoc = externalDocumentId ? externalDocMap.get(externalDocumentId) : undefined

    let source: 'native' | 'google_workspace' = 'native'
    let sourceTag = 'NATIVE'
    let documentTitle = thread?.name ?? 'Unknown'

    if (externalDoc) {
      source = 'google_workspace'
      documentTitle = externalDoc.title
      switch (externalDoc.docType) {
        case 'google_docs':
          sourceTag = 'G.DOCS'
          break
        case 'google_sheets':
          sourceTag = 'G.SHEETS'
          break
        case 'google_slides':
          sourceTag = 'G.SLIDES'
          break
      }
    } else if (thread?.type === 'browser') {
      sourceTag = 'BROWSER'
    }

    return {
      ...event,
      source,
      sourceTag,
      documentTitle,
      threadType: thread?.type ?? 'unknown',
    }
  })

  return c.json({
    data: annotated,
    strand: {
      id: strand.id,
      name: strand.name,
      color: strand.color,
      summaryText: strand.summaryText,
    },
    externalDocuments: externalDocs.map((d) => ({
      id: d.id,
      googleDocId: d.externalDocId,
      docType: d.docType,
      title: d.title,
      lastSyncAt: d.updatedAt,
    })),
    pagination: {
      hasMore: events.length === limit,
      nextCursor: events.length > 0 ? events[events.length - 1]!.time.toISOString() : null,
    },
  })
})

// ─── GET /documents/:externalDocId/collaborators — List document trackers ──

gwsRouter.get('/documents/:externalDocId/collaborators', async (c) => {
  const externalDocId = c.req.param('externalDocId')
  const workspaceId = c.get('workspaceId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const docs = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.externalDocId, externalDocId),
        eq(externalDocuments.workspaceId, workspaceId),
        eq(externalDocuments.isActive, true)
      )
    )
    .limit(1)

  if (docs.length === 0) {
    return c.json({ data: [] })
  }

  const { documentTrackers } = await import('../db/schema/external-documents')
  const { users } = await import('../db/schema/users')

  const trackers = await db
    .select({
      id: documentTrackers.id,
      userId: documentTrackers.userId,
      role: documentTrackers.role,
      isActive: documentTrackers.isActive,
      joinedAt: documentTrackers.joinedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(documentTrackers)
    .innerJoin(users, eq(documentTrackers.userId, users.id))
    .where(eq(documentTrackers.externalDocumentId, docs[0]!.id))

  return c.json({ data: trackers })
})

// ─── Sprint IX-9: GWS Content Snapshots ────────────────────────────────────

// POST /snapshot — capture a versioned content snapshot of a Google document.
// Called by the GWS extension on significant edits / periodic timers / pre-share.
gwsRouter.post('/snapshot', async (c) => {
  const workspaceId = c.get('workspaceId') as string
  const userId = c.get('userId') as string

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const body = await c.req.json<{
    externalDocId: string
    docType?: 'document' | 'spreadsheet' | 'presentation' | 'docs' | 'sheets' | 'slides'
    content: string
    title?: string
    triggerType: 'periodic' | 'significant_edit' | 'manual' | 'pre_share'
    metadata?: Record<string, unknown>
  }>()

  if (!body.externalDocId || typeof body.content !== 'string') {
    return c.json({ error: 'externalDocId and content are required' }, 400)
  }

  const { captureGwsSnapshot, normalizeDocType } = await import('../services/gws/snapshot-capture')

  const result = await captureGwsSnapshot({
    workspaceId,
    userId,
    externalDocId: body.externalDocId,
    docType: normalizeDocType(body.docType),
    content: body.content,
    title: body.title,
    triggerType: body.triggerType ?? 'manual',
    metadata: body.metadata,
  })

  return c.json({ data: result })
})

// GET /snapshot/:externalDocId — retrieve a snapshot.
// Query params: ?version=14 | ?before=2026-04-08T00:00:00Z | (default: latest)
gwsRouter.get('/snapshot/:externalDocId', async (c) => {
  const workspaceId = c.get('workspaceId') as string
  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied
  const externalDocId = c.req.param('externalDocId')
  const version = c.req.query('version')
  const before = c.req.query('before')

  const { getGwsSnapshot, getLatestGwsSnapshot } = await import('../services/gws/snapshot-capture')

  if (version) {
    const n = Number.parseInt(version, 10)
    if (!Number.isFinite(n)) {
      return c.json({ error: 'version must be an integer' }, 400)
    }
    const snapshot = await getGwsSnapshot(workspaceId, externalDocId, n)
    return c.json({ data: snapshot })
  }

  if (before) {
    const ts = new Date(before)
    if (Number.isNaN(ts.getTime())) {
      return c.json({ error: 'before must be an ISO timestamp' }, 400)
    }
    const snapshot = await getGwsSnapshot(workspaceId, externalDocId, ts)
    return c.json({ data: snapshot })
  }

  // Default: return the latest (highest version) snapshot
  const snapshot = await getLatestGwsSnapshot(workspaceId, externalDocId)
  return c.json({ data: snapshot })
})
