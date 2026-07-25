import { Hono } from 'hono'
import type { Context } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index'
import { fileShares } from '../db/schema/collaboration'
import { files } from '../db/schema/files'
import { users } from '../db/schema/users'
import { privacyFilterRules, sharedSlices } from '../db/schema/sharing'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import { nanoid } from 'nanoid'
import { emitNotification } from '../services/notifications/emit'

const app = new Hono()

app.use('*', authMiddleware)

// ─── Cross-tenant guards ─────────────────────────────────────────────
// Load a resource's owning workspaceId, then assert the caller is a member
// of that workspace. Returns a ready-to-return error Response (404 when the
// resource is gone, 401/403 on deny) or null when access is granted.
async function guardFileAccess(c: Context, fileId: string): Promise<Response | null> {
  const [file] = await db
    .select({ workspaceId: files.workspaceId })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1)
  if (!file) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }
  return assertWorkspaceAccess(c, file.workspaceId)
}

async function guardSliceAccess(c: Context, sliceId: string): Promise<Response | null> {
  const [slice] = await db
    .select({ workspaceId: sharedSlices.workspaceId })
    .from(sharedSlices)
    .where(eq(sharedSlices.id, sliceId))
    .limit(1)
  if (!slice) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Slice not found' } }, 404)
  }
  return assertWorkspaceAccess(c, slice.workspaceId)
}

// ─── Share a file with a user ────────────────────────────────────────
app.post('/files/:fileId/share', async (c) => {
  const userId = c.get('userId')
  const fileId = c.req.param('fileId')
  const body = await c.req.json<{
    userId?: string
    email?: string
    permission?: 'viewer' | 'editor'
    /** Per-share visibility toggles applied to provenance views (Sprint C-3) */
    contextToggles?: {
      documentHistory?: boolean
      aiUsageTrail?: boolean
      generalChats?: boolean
      evidenceNotes?: boolean
      attachedSources?: boolean
    }
  }>()

  // Verify file exists
  const [file] = await db.select().from(files).where(eq(files.id, fileId))
  if (!file) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  const denied = await assertWorkspaceAccess(c, file.workspaceId)
  if (denied) return denied

  let targetUserId = body.userId ?? null

  // If email provided, look up user
  if (!targetUserId && body.email) {
    const [user] = await db.select().from(users).where(eq(users.email, body.email))
    targetUserId = user?.id ?? null
  }

  const [share] = await db
    .insert(fileShares)
    .values({
      fileId,
      userId: targetUserId,
      permission: body.permission ?? 'viewer',
      sharedBy: userId,
      metadata: body.contextToggles ? { contextToggles: body.contextToggles } : {},
    })
    .returning()

  // Notify the recipient (when sharing with a known user, not just an email)
  if (targetUserId && targetUserId !== userId) {
    await emitNotification({
      workspaceId: file.workspaceId,
      userId: targetUserId,
      type: 'share',
      title: `${file.name} was shared with you`,
      body: '',
      link: `/follow/doc/${fileId}`,
      metadata: { fileId, sharedBy: userId, permission: body.permission ?? 'viewer' },
    })
  }

  // Create sealed snapshot on share (non-blocking)
  try {
    const { createSealedSnapshot } = await import('../services/semantic-index/sealed-snapshot')
    const { extractFileContent } = await import('../services/document/yjs-text-extractor')

    let documentContent = ''
    const documentTitle = file.name

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- extractor takes the raw file row shape
    const outline = extractFileContent(file as any)
    if (outline?.fullText) {
      documentContent = outline.fullText
    }

    if (documentContent) {
      createSealedSnapshot({
        documentId: fileId,
        workspaceId: file.workspaceId,
        userId,
        trigger: 'shared_externally',
        sharedWith: body.email ?? targetUserId ?? undefined,
        documentContent,
        documentTitle,
      }).catch((err: Error) =>
        console.warn('[SealedSnapshot] Failed on share (non-blocking):', err.message)
      )
    }
  } catch {
    // Sealed snapshot creation failed — non-blocking
  }

  return c.json({ data: share, error: null }, 201)
})

// ─── Shared with me ──────────────────────────────────────────────────
app.get('/shared-with-me', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  const results = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      spaceId: files.spaceId,
      parentFolderId: files.parentFolderId,
      name: files.name,
      type: files.type,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      version: files.version,
      metadata: files.metadata,
      createdBy: files.createdBy,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
      deletedAt: files.deletedAt,
      permission: fileShares.permission,
      sharedBy: fileShares.sharedBy,
    })
    .from(fileShares)
    .innerJoin(files, eq(fileShares.fileId, files.id))
    .where(and(eq(fileShares.userId, userId), eq(files.workspaceId, workspaceId)))

  return c.json({ data: results, error: null })
})

// ─── Get the calling user's share record (for context-toggle enforcement) ──
app.get('/files/:fileId/my-share', async (c) => {
  const userId = c.get('userId')
  const fileId = c.req.param('fileId')

  const [share] = await db
    .select()
    .from(fileShares)
    .where(and(eq(fileShares.fileId, fileId), eq(fileShares.userId, userId)))
    .limit(1)

  return c.json({ data: share ?? null, error: null })
})

// ─── List who has access to a file ───────────────────────────────────
app.get('/files/:fileId/shares', async (c) => {
  const fileId = c.req.param('fileId')

  const denied = await guardFileAccess(c, fileId)
  if (denied) return denied

  const results = await db
    .select({
      share: fileShares,
      userName: users.name,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
    })
    .from(fileShares)
    .leftJoin(users, eq(fileShares.userId, users.id))
    .where(eq(fileShares.fileId, fileId))

  return c.json({
    data: results.map((r) => ({
      ...r.share,
      userName: r.userName,
      userEmail: r.userEmail,
      userAvatar: r.userAvatar,
    })),
    error: null,
  })
})

// ─── Update share permissions ────────────────────────────────────────
app.patch('/files/:fileId/shares/:shareUserId', async (c) => {
  const fileId = c.req.param('fileId')
  const shareUserId = c.req.param('shareUserId')
  const body = await c.req.json<{ permission: 'viewer' | 'editor' }>()

  const denied = await guardFileAccess(c, fileId)
  if (denied) return denied

  const [updated] = await db
    .update(fileShares)
    .set({ permission: body.permission })
    .where(and(eq(fileShares.fileId, fileId), eq(fileShares.userId, shareUserId)))
    .returning()

  if (!updated) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Share not found' } }, 404)
  }

  return c.json({ data: updated, error: null })
})

// ─── Remove access ───────────────────────────────────────────────────
app.delete('/files/:fileId/shares/:shareUserId', async (c) => {
  const fileId = c.req.param('fileId')
  const shareUserId = c.req.param('shareUserId')

  const denied = await guardFileAccess(c, fileId)
  if (denied) return denied

  await db
    .delete(fileShares)
    .where(and(eq(fileShares.fileId, fileId), eq(fileShares.userId, shareUserId)))

  return c.json({ data: { success: true }, error: null })
})

// ─── Enable link sharing ─────────────────────────────────────────────
app.post('/files/:fileId/link', async (c) => {
  const userId = c.get('userId')
  const fileId = c.req.param('fileId')
  const body = await c.req.json<{ permission?: 'viewer' | 'editor' }>()

  const denied = await guardFileAccess(c, fileId)
  if (denied) return denied

  const shareToken = nanoid(32)

  const [share] = await db
    .insert(fileShares)
    .values({
      fileId,
      userId: null,
      permission: body.permission ?? 'viewer',
      sharedBy: userId,
      shareToken,
    })
    .returning()

  return c.json(
    {
      data: {
        ...share,
        shareUrl: `${process.env['NEXT_PUBLIC_URL'] ?? 'http://localhost:3000'}/shared/${shareToken}`,
      },
      error: null,
    },
    201
  )
})

// ─── Sprint SH-1: Passcode Lock + Privacy Filters ──────────────────────────
//
// The routes below gate access to a user's index with a passcode and
// expose the privacy-filter preset + custom-rule management surface.
// These are additive to the existing file-sharing routes above — both
// live on the same `/api/sharing` router because they share the scope.

// POST /api/sharing/passcode/setup — set or update passcode
app.post('/passcode/setup', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? c.req.query('workspaceId')
  const body = await c.req.json<{ passcode?: string }>()

  if (!body.passcode || body.passcode.length < 4) {
    return c.json(
      {
        data: null,
        error: { code: 'BAD_REQUEST', message: 'Passcode must be at least 4 characters' },
      },
      400
    )
  }
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  const { setPasscode } = await import('../services/sharing/passcode')
  const result = await setPasscode({ userId, workspaceId, passcode: body.passcode })
  return c.json({ data: result, error: null })
})

// POST /api/sharing/passcode/unlock — unlock index with passcode
app.post('/passcode/unlock', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ passcode?: string }>()

  if (!body.passcode) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'passcode required' } }, 400)
  }

  const { unlockIndex } = await import('../services/sharing/passcode')
  const result = await unlockIndex({ userId, passcode: body.passcode })

  if (!result.success) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid passcode' } }, 401)
  }

  return c.json({
    data: { sessionToken: result.sessionToken, expiresAt: result.expiresAt },
    error: null,
  })
})

// POST /api/sharing/passcode/lock — explicitly lock the index
app.post('/passcode/lock', async (c) => {
  const userId = c.get('userId')
  const { lockIndex } = await import('../services/sharing/passcode')
  await lockIndex(userId)
  return c.json({ data: { locked: true }, error: null })
})

// GET /api/sharing/status — lock state + active preset
app.get('/status', async (c) => {
  const userId = c.get('userId')
  const { getIndexLockState } = await import('../services/sharing/passcode')
  const state = await getIndexLockState(userId)
  return c.json({
    data: {
      ...state,
      sessionExpiresAt: state.sessionExpiresAt ? state.sessionExpiresAt.toISOString() : null,
    },
    error: null,
  })
})

// GET /api/sharing/presets — preset definitions (no auth-sensitive data)
app.get('/presets', async (c) => {
  const { getPresetDefinitions } = await import('../services/sharing/privacy-filter')
  return c.json({ data: getPresetDefinitions(), error: null })
})

// PUT /api/sharing/preset — set active preset
app.put('/preset', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ preset?: string }>()

  if (!body.preset || !['private', 'balanced', 'open', 'custom'].includes(body.preset)) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'Invalid preset' } }, 400)
  }

  const { setActivePreset } = await import('../services/sharing/privacy-filter')
  await setActivePreset({
    userId,
    preset: body.preset as 'private' | 'balanced' | 'open' | 'custom',
  })
  return c.json({ data: { preset: body.preset }, error: null })
})

// GET /api/sharing/rules — list custom privacy rules
app.get('/rules', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? c.req.query('workspaceId')
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }
  const { getCustomRules } = await import('../services/sharing/privacy-filter')
  const rules = await getCustomRules({ userId, workspaceId })
  return c.json({ data: rules, error: null })
})

// POST /api/sharing/rules — create a custom rule
app.post('/rules', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    workspaceId?: string
    ruleName?: string
    ruleType?: string
    ruleConfig?: Record<string, unknown>
    scope?: string
    scopeDocumentId?: string
    priority?: number
  }>()

  const workspaceId = body.workspaceId ?? c.get('workspaceId')
  if (!workspaceId || !body.ruleName || !body.ruleType || !body.ruleConfig) {
    return c.json(
      {
        data: null,
        error: {
          code: 'BAD_REQUEST',
          message: 'workspaceId, ruleName, ruleType, and ruleConfig are required',
        },
      },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const { addCustomRule } = await import('../services/sharing/privacy-filter')
  const result = await addCustomRule({
    userId,
    workspaceId,
    ruleName: body.ruleName,
    ruleType: body.ruleType,
    ruleConfig: body.ruleConfig,
    scope: body.scope,
    scopeDocumentId: body.scopeDocumentId,
    priority: body.priority,
  })
  return c.json({ data: result, error: null }, 201)
})

// DELETE /api/sharing/rules/:id — remove a custom rule
app.delete('/rules/:id', async (c) => {
  const id = c.req.param('id')

  // Cross-tenant guard: load the rule's owning workspace and assert membership.
  const [rule] = await db
    .select({ workspaceId: privacyFilterRules.workspaceId })
    .from(privacyFilterRules)
    .where(eq(privacyFilterRules.id, id))
    .limit(1)
  if (!rule) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Rule not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, rule.workspaceId)
  if (denied) return denied

  const { removeCustomRule } = await import('../services/sharing/privacy-filter')
  await removeCustomRule(id)
  return c.json({ data: { deleted: true }, error: null })
})

// ─── Sprint SH-2: Context Requests + Shared Slices ─────────────────────────
//
// Request lifecycle: create → pending → approved (slice built) | denied | expired.
// Slice management: list received/sent + soft-revoke.
// All endpoints share the existing router-wide `authMiddleware`.

// POST /api/sharing/requests — create a context request
app.post('/requests', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    responderId?: string
    workspaceId?: string
    scopeType?: 'document' | 'topic' | 'temporal'
    scopeRefId?: string
    query?: string
    urgency?: 'low' | 'normal' | 'high'
    reason?: string
    expiresInMinutes?: number
  }>()

  const workspaceId = body.workspaceId ?? c.get('workspaceId')
  if (!body.responderId || !body.scopeType || !body.query || !workspaceId) {
    return c.json(
      {
        data: null,
        error: {
          code: 'BAD_REQUEST',
          message: 'responderId, scopeType, query, and workspaceId are required',
        },
      },
      400
    )
  }
  if (!['document', 'topic', 'temporal'].includes(body.scopeType)) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'Invalid scopeType' } }, 400)
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const { createContextRequest } = await import('../services/sharing/context-request')
  const result = await createContextRequest({
    requesterId: userId,
    responderId: body.responderId,
    workspaceId,
    scopeType: body.scopeType,
    scopeRefId: body.scopeRefId,
    query: body.query,
    urgency: body.urgency,
    reason: body.reason,
    expiresInMinutes: body.expiresInMinutes,
  })
  return c.json({ data: result, error: null }, 201)
})

// POST /api/sharing/requests/:id/approve — approve + build slice
app.post('/requests/:id/approve', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json<{ sessionToken?: string }>()

  if (!body.sessionToken) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'sessionToken required' } },
      400
    )
  }

  const { approveContextRequest } = await import('../services/sharing/context-request')
  const result = await approveContextRequest({
    requestId: id,
    responderId: userId,
    sessionToken: body.sessionToken,
  })

  if (!result.success) {
    return c.json(
      {
        data: null,
        error: { code: 'APPROVAL_FAILED', message: result.reason ?? 'Approval failed' },
      },
      400
    )
  }
  return c.json({ data: { sliceId: result.sliceId }, error: null })
})

// POST /api/sharing/requests/:id/deny — deny a request
app.post('/requests/:id/deny', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string })

  const { denyContextRequest } = await import('../services/sharing/context-request')
  const result = await denyContextRequest({
    requestId: id,
    responderId: userId,
    reason: body.reason,
  })

  if (!result.success) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Request not found or not yours' } },
      404
    )
  }
  return c.json({ data: result, error: null })
})

// GET /api/sharing/requests/inbox — pending requests addressed to me
app.get('/requests/inbox', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId') ?? c.get('workspaceId')

  const { getPendingRequests } = await import('../services/sharing/context-request')
  const requests = await getPendingRequests(userId, workspaceId)
  return c.json({ data: requests, error: null })
})

// GET /api/sharing/requests/sent — my outgoing requests
app.get('/requests/sent', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId') ?? c.get('workspaceId')

  const { getOutgoingRequests } = await import('../services/sharing/context-request')
  const requests = await getOutgoingRequests(userId, workspaceId)
  return c.json({ data: requests, error: null })
})

// GET /api/sharing/slices/received — slices shared with me
app.get('/slices/received', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId') ?? c.get('workspaceId')
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  const { getReceivedSlices } = await import('../services/sharing/slice-builder')
  const slices = await getReceivedSlices({ toUserId: userId, workspaceId })
  return c.json({ data: slices, error: null })
})

// GET /api/sharing/slices/sent — slices I have shared
app.get('/slices/sent', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId') ?? c.get('workspaceId')
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  const { getSentSlices } = await import('../services/sharing/slice-builder')
  const slices = await getSentSlices({ fromUserId: userId, workspaceId })
  return c.json({ data: slices, error: null })
})

// POST /api/sharing/slices/:id/revoke — soft-delete a slice
app.post('/slices/:id/revoke', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string })

  const { revokeSlice } = await import('../services/sharing/slice-builder')
  const result = await revokeSlice({
    sliceId: id,
    fromUserId: userId,
    reason: body.reason,
  })

  if (!result.success) {
    return c.json(
      { data: null, error: { code: 'FORBIDDEN', message: 'Cannot revoke this slice' } },
      403
    )
  }
  return c.json({ data: result, error: null })
})

// ─── Sprint SH-3: Live Sync ────────────────────────────────────────────────

// POST /api/sharing/slices/:id/upgrade-to-live
// Only the sharer (fromUserId) can approve. Requires a valid session token
// (SH-1 passcode lock) so the sharer must have explicitly unlocked their
// index before the channel can open.
app.post('/slices/:id/upgrade-to-live', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json<{ sessionToken?: string }>()

  if (!body.sessionToken) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'sessionToken required' } },
      400
    )
  }

  const { upgradeToLive } = await import('../services/sharing/sync-service')
  const result = await upgradeToLive({
    sliceId: id,
    approvedByUserId: userId,
    sessionToken: body.sessionToken,
  })

  if (!result.success) {
    return c.json(
      {
        data: null,
        error: { code: 'UPGRADE_FAILED', message: result.reason ?? 'Upgrade failed' },
      },
      400
    )
  }
  return c.json({ data: { syncStatus: 'live' }, error: null })
})

// POST /api/sharing/slices/:id/downgrade-to-shared
// Either party can do this unilaterally — downgrades only close flows,
// they don't open new ones, so no session token required.
app.post('/slices/:id/downgrade-to-shared', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const { downgradeToShared } = await import('../services/sharing/sync-service')
  const result = await downgradeToShared({ sliceId: id, userId })

  if (!result.success) {
    return c.json(
      {
        data: null,
        error: { code: 'DOWNGRADE_FAILED', message: result.reason ?? 'Downgrade failed' },
      },
      400
    )
  }
  return c.json({ data: { syncStatus: 'shared' }, error: null })
})

// POST /api/sharing/slices/:id/sync — manual sync trigger (testing / refresh)
app.post('/slices/:id/sync', async (c) => {
  const id = c.req.param('id')

  const denied = await guardSliceAccess(c, id)
  if (denied) return denied

  const { syncLiveSlice } = await import('../services/sharing/sync-service')
  const result = await syncLiveSlice(id)
  return c.json({ data: result, error: null })
})

// GET /api/sharing/slices/:id/sync-history — full audit trail
app.get('/slices/:id/sync-history', async (c) => {
  const id = c.req.param('id')

  const denied = await guardSliceAccess(c, id)
  if (denied) return denied

  const { getSyncEvents } = await import('../services/sharing/sync-service')
  const events = await getSyncEvents(id)
  return c.json({ data: events, error: null })
})

export const sharingRouter = app
