import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull, like, or, desc, asc, sql, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index'
import { files, fileVersions } from '../db/schema/files'
import { users } from '../db/schema/users'
import { documentViews } from '../db/schema/collaboration'
import { threads, threadEvents } from '../db/schema/threads'
import { gte } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { getUploadUrl, getDownloadUrl, getStorageKey } from '../lib/s3'
import { EventBus } from '../events/EventBus'
import { assertWorkspaceAccess } from '../services/workspace-access'

const CreateFileSchema = z.object({
  workspaceId: z.string().uuid(),
  parentFolderId: z.string().uuid().nullable().optional(),
  spaceId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  type: z.enum(['file', 'folder', 'notebook']),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  templateId: z.string().uuid().optional(),
})

const UpdateFileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  spaceId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const BulkActionSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1),
  action: z.enum(['move', 'delete', 'restore']),
  parentFolderId: z.string().uuid().nullable().optional(),
})

function getSortColumn(sortBy: string) {
  switch (sortBy) {
    case 'created_at':
      return files.createdAt
    case 'updated_at':
      return files.updatedAt
    case 'size':
      return files.sizeBytes
    case 'type':
      return files.type
    default:
      return files.name
  }
}

export const filesRouter = new Hono()

filesRouter.use('*', authMiddleware)

filesRouter.post('/', zValidator('json', CreateFileSchema), async (c) => {
  const body = c.req.valid('json')
  const userId = c.get('userId')

  const denied = await assertWorkspaceAccess(c, body.workspaceId)
  if (denied) return denied

  // If templateId is provided, copy template metadata into the new file
  let templateMetadata: Record<string, unknown> | null = null
  if (body.templateId) {
    const [template] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, body.templateId), isNull(files.deletedAt)))
    if (template) {
      const tmplMeta = (template.metadata ?? {}) as Record<string, unknown>
      // Strip the isTemplate flag so the new file is a real document, not another template
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-destructuring strips the flags
      const { isTemplate: _isTemplate, templateType: _templateType, ...rest } = tmplMeta
      templateMetadata = rest
    }
  }

  const [created] = await db
    .insert(files)
    .values({
      workspaceId: body.workspaceId,
      parentFolderId: body.parentFolderId ?? null,
      spaceId: body.spaceId ?? null,
      name: body.name,
      type: body.type,
      mimeType: body.mimeType ?? null,
      sizeBytes: body.sizeBytes ?? null,
      metadata: { ...(templateMetadata ?? {}), ...(body.metadata ?? {}) },
      createdBy: userId,
    })
    .returning()

  const file = created!

  let uploadUrl: string | undefined
  if (body.type === 'file' && body.mimeType) {
    const key = getStorageKey(body.workspaceId, file.id, 1)
    try {
      uploadUrl = await getUploadUrl(key, body.mimeType)
      await db.update(files).set({ storagePath: key }).where(eq(files.id, file.id))
    } catch {
      // S3 not configured - store path anyway for future use
      await db.update(files).set({ storagePath: key }).where(eq(files.id, file.id))
    }

    await db.insert(fileVersions).values({
      fileId: file.id,
      versionNumber: 1,
      storagePath: key,
      sizeBytes: body.sizeBytes ?? null,
      createdBy: userId,
    })
  }

  const workspaceId = c.get('workspaceId') ?? body.workspaceId
  await EventBus.emit({
    workspaceId,
    userId,
    actionType: 'file_created',
    objectType: body.type,
    objectId: file.id,
    payload: { name: body.name, type: body.type },
  })

  return c.json({ data: { ...file, uploadUrl }, error: null }, 201)
})

filesRouter.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  const parentFolderId = c.req.query('parentFolderId')
  const spaceId = c.req.query('spaceId')
  const mimeType = c.req.query('mimeType')
  const isTemplate = c.req.query('isTemplate')
  const sortBy = c.req.query('sortBy') ?? 'name'
  const sortDir = c.req.query('sortDir') ?? 'asc'
  const includeTrash = c.req.query('includeTrash') === 'true'

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId is required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const conditions = [eq(files.workspaceId, workspaceId)]

  // spaceId filter takes precedence over folder restriction so projects can show all docs
  if (spaceId) {
    conditions.push(eq(files.spaceId, spaceId))
  } else if (mimeType) {
    // When filtering by mimeType, don't restrict to root folder
    conditions.push(eq(files.mimeType, mimeType))
  } else if (parentFolderId === 'null' || parentFolderId === undefined) {
    conditions.push(isNull(files.parentFolderId))
  } else if (parentFolderId) {
    conditions.push(eq(files.parentFolderId, parentFolderId))
  }

  if (mimeType && spaceId) {
    conditions.push(eq(files.mimeType, mimeType))
  }

  // Templates are excluded by default; pass isTemplate=true to fetch them
  if (isTemplate === 'true') {
    conditions.push(sql`(${files.metadata}->>'isTemplate')::boolean = true`)
  } else {
    conditions.push(
      sql`(${files.metadata}->>'isTemplate' IS NULL OR (${files.metadata}->>'isTemplate')::boolean = false)`
    )
  }

  if (!includeTrash) {
    conditions.push(isNull(files.deletedAt))
  }

  const sortColumn = getSortColumn(sortBy)
  const orderFn = sortDir === 'desc' ? desc : asc

  const result = await db
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
      createdByName: users.name,
    })
    .from(files)
    .leftJoin(users, eq(files.createdBy, users.id))
    .where(and(...conditions))
    .orderBy(orderFn(sortColumn))

  return c.json({ data: result, error: null })
})

filesRouter.get('/templates', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId is required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const result = await db
    .select({
      id: files.id,
      name: files.name,
      type: files.type,
      mimeType: files.mimeType,
      metadata: files.metadata,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .where(
      and(
        eq(files.workspaceId, workspaceId),
        isNull(files.deletedAt),
        sql`(${files.metadata}->>'isTemplate')::boolean = true`
      )
    )
    .orderBy(asc(files.name))

  return c.json({ data: result, error: null })
})

filesRouter.get('/search', async (c) => {
  const q = c.req.query('q')
  const workspaceId = c.req.query('workspaceId')

  if (!q || !workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'q and workspaceId are required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const result = await db
    .select({
      id: files.id,
      name: files.name,
      type: files.type,
      mimeType: files.mimeType,
      parentFolderId: files.parentFolderId,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .where(
      and(
        eq(files.workspaceId, workspaceId),
        isNull(files.deletedAt),
        or(like(files.name, `%${q}%`), sql`${files.metadata}::text ILIKE ${'%' + q + '%'}`)
      )
    )
    .limit(20)

  return c.json({ data: result, error: null })
})

filesRouter.get('/:id', async (c) => {
  const id = c.req.param('id')

  const [file] = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      spaceId: files.spaceId,
      parentFolderId: files.parentFolderId,
      name: files.name,
      type: files.type,
      mimeType: files.mimeType,
      storagePath: files.storagePath,
      sizeBytes: files.sizeBytes,
      version: files.version,
      metadata: files.metadata,
      createdBy: files.createdBy,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
      deletedAt: files.deletedAt,
      createdByName: users.name,
    })
    .from(files)
    .leftJoin(users, eq(files.createdBy, users.id))
    .where(eq(files.id, id))

  if (!file) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  const denied = await assertWorkspaceAccess(c, file.workspaceId)
  if (denied) return denied

  let downloadUrl: string | undefined
  if (file.storagePath) {
    try {
      downloadUrl = await getDownloadUrl(file.storagePath)
    } catch {
      // S3 not configured
    }
  }

  return c.json({ data: { ...file, downloadUrl }, error: null })
})

filesRouter.patch('/:id', zValidator('json', UpdateFileSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const userId = c.get('userId')

  const [existing] = await db
    .select({ workspaceId: files.workspaceId })
    .from(files)
    .where(eq(files.id, id))
    .limit(1)
  if (!existing) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, existing.workspaceId)
  if (denied) return denied

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.parentFolderId !== undefined) updates.parentFolderId = body.parentFolderId
  if (body.spaceId !== undefined) updates.spaceId = body.spaceId
  if (body.metadata !== undefined) updates.metadata = body.metadata

  const [updated] = await db
    .update(files)
    .set(updates)
    .where(and(eq(files.id, id), isNull(files.deletedAt)))
    .returning()

  if (!updated) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  const workspaceId = c.get('workspaceId') ?? updated.workspaceId
  await EventBus.emit({
    workspaceId,
    userId,
    actionType: body.parentFolderId !== undefined ? 'file_moved' : 'file_updated',
    objectType: updated.type,
    objectId: updated.id,
    payload: body,
  })

  return c.json({ data: updated, error: null })
})

filesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')

  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), isNull(files.deletedAt)))

  if (!file) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  const denied = await assertWorkspaceAccess(c, file.workspaceId)
  if (denied) return denied

  const now = new Date()

  await db.update(files).set({ deletedAt: now }).where(eq(files.id, id))

  if (file.type === 'folder') {
    await softDeleteChildren(id, now)
  }

  const workspaceId = c.get('workspaceId') ?? file.workspaceId
  await EventBus.emit({
    workspaceId,
    userId,
    actionType: 'file_deleted',
    objectType: file.type,
    objectId: file.id,
    payload: { name: file.name },
  })

  return c.json({ data: { id }, error: null })
})

async function softDeleteChildren(parentId: string, deletedAt: Date): Promise<void> {
  const children = await db
    .select()
    .from(files)
    .where(and(eq(files.parentFolderId, parentId), isNull(files.deletedAt)))

  for (const child of children) {
    await db.update(files).set({ deletedAt }).where(eq(files.id, child.id))
    if (child.type === 'folder') {
      await softDeleteChildren(child.id, deletedAt)
    }
  }
}

filesRouter.post('/:id/restore', async (c) => {
  const id = c.req.param('id')

  const [existing] = await db
    .select({ workspaceId: files.workspaceId })
    .from(files)
    .where(eq(files.id, id))
    .limit(1)
  if (!existing) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, existing.workspaceId)
  if (denied) return denied

  const [restored] = await db
    .update(files)
    .set({ deletedAt: null })
    .where(eq(files.id, id))
    .returning()

  if (!restored) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  if (restored.type === 'folder') {
    await restoreChildren(id)
  }

  return c.json({ data: restored, error: null })
})

async function restoreChildren(parentId: string): Promise<void> {
  const children = await db.select().from(files).where(eq(files.parentFolderId, parentId))

  for (const child of children) {
    await db.update(files).set({ deletedAt: null }).where(eq(files.id, child.id))
    if (child.type === 'folder') {
      await restoreChildren(child.id)
    }
  }
}

filesRouter.post('/:id/duplicate', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')

  const [original] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), isNull(files.deletedAt)))

  if (!original) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  const denied = await assertWorkspaceAccess(c, original.workspaceId)
  if (denied) return denied

  const [copy] = await db
    .insert(files)
    .values({
      workspaceId: original.workspaceId,
      parentFolderId: original.parentFolderId,
      name: `${original.name} (copy)`,
      type: original.type,
      mimeType: original.mimeType,
      storagePath: original.storagePath,
      sizeBytes: original.sizeBytes,
      metadata: original.metadata,
      createdBy: userId,
    })
    .returning()

  return c.json({ data: copy, error: null }, 201)
})

filesRouter.patch('/bulk', zValidator('json', BulkActionSchema), async (c) => {
  const { fileIds, action, parentFolderId } = c.req.valid('json')

  // Guard: every target file's workspace must be accessible to the caller.
  const targetRows = await db
    .select({ workspaceId: files.workspaceId })
    .from(files)
    .where(inArray(files.id, fileIds))
  for (const wsId of [...new Set(targetRows.map((r) => r.workspaceId))]) {
    const denied = await assertWorkspaceAccess(c, wsId)
    if (denied) return denied
  }

  if (action === 'delete') {
    const now = new Date()
    await db.update(files).set({ deletedAt: now }).where(inArray(files.id, fileIds))

    return c.json({ data: { affected: fileIds.length }, error: null })
  }

  if (action === 'restore') {
    await db.update(files).set({ deletedAt: null }).where(inArray(files.id, fileIds))

    return c.json({ data: { affected: fileIds.length }, error: null })
  }

  if (action === 'move') {
    await db
      .update(files)
      .set({ parentFolderId: parentFolderId ?? null, updatedAt: new Date() })
      .where(inArray(files.id, fileIds))

    return c.json({ data: { affected: fileIds.length }, error: null })
  }

  return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'Invalid action' } }, 400)
})

// --- File Versions ---

filesRouter.get('/:id/versions', async (c) => {
  const fileId = c.req.param('id')

  const [file] = await db
    .select({ workspaceId: files.workspaceId })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1)
  if (!file) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, file.workspaceId)
  if (denied) return denied

  const versions = await db
    .select({
      id: fileVersions.id,
      fileId: fileVersions.fileId,
      versionNumber: fileVersions.versionNumber,
      sizeBytes: fileVersions.sizeBytes,
      createdBy: fileVersions.createdBy,
      createdAt: fileVersions.createdAt,
      diffSummary: fileVersions.diffSummary,
      createdByName: users.name,
    })
    .from(fileVersions)
    .leftJoin(users, eq(fileVersions.createdBy, users.id))
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.versionNumber))

  return c.json({ data: versions, error: null })
})

filesRouter.get('/:id/versions/:versionId', async (c) => {
  const versionId = c.req.param('versionId')

  const [version] = await db.select().from(fileVersions).where(eq(fileVersions.id, versionId))

  if (!version) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Version not found' } }, 404)
  }

  const [file] = await db
    .select({ workspaceId: files.workspaceId })
    .from(files)
    .where(eq(files.id, version.fileId))
    .limit(1)
  if (!file) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, file.workspaceId)
  if (denied) return denied

  let downloadUrl: string | undefined
  try {
    downloadUrl = await getDownloadUrl(version.storagePath)
  } catch {
    // S3 not configured
  }

  return c.json({ data: { ...version, downloadUrl }, error: null })
})

// ─── Document Views (last-seen tracking for "While You Were Away") ────

filesRouter.post('/:id/view', async (c) => {
  const userId = c.get('userId') as string
  const fileId = c.req.param('id')
  const now = new Date()

  await db
    .insert(documentViews)
    .values({ fileId, userId, lastSeenAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [documentViews.fileId, documentViews.userId],
      set: { lastSeenAt: now, updatedAt: now },
    })

  return c.json({ data: { lastSeenAt: now.toISOString() }, error: null })
})

filesRouter.get('/:id/last-seen', async (c) => {
  const userId = c.get('userId') as string
  const fileId = c.req.param('id')

  const [view] = await db
    .select()
    .from(documentViews)
    .where(and(eq(documentViews.fileId, fileId), eq(documentViews.userId, userId)))
    .limit(1)

  return c.json({ data: view ?? null, error: null })
})

/**
 * GET /api/files/:id/changes-since?since=ISO
 *
 * Returns aggregated activity on this file's threads since the given
 * timestamp. Used by the floating-unit "While You Were Away" card.
 */
filesRouter.get('/:id/changes-since', async (c) => {
  const fileId = c.req.param('id')
  const sinceParam = c.req.query('since')
  if (!sinceParam) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'since required' } }, 400)
  }
  const [file] = await db
    .select({ workspaceId: files.workspaceId })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1)
  if (!file) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, file.workspaceId)
  if (denied) return denied

  const since = new Date(sinceParam)

  // Find threads attached to this file (metadata.fileId match)
  const fileThreads = await db
    .select({ id: threads.id, ownerId: threads.ownerId, type: threads.type, name: threads.name })
    .from(threads)
    .where(sql`${threads.metadata}->>'fileId' = ${fileId}`)

  const threadIds = fileThreads.map((t) => t.id)
  if (threadIds.length === 0) {
    return c.json({ data: { hasChanges: false, users: [], aiEdits: 0, tensions: 0 }, error: null })
  }

  const events = await db
    .select()
    .from(threadEvents)
    .where(and(inArray(threadEvents.threadId, threadIds), gte(threadEvents.time, since)))
    .orderBy(desc(threadEvents.time))
    .limit(200)

  // Aggregate by thread owner
  const byOwner: Record<string, { ownerId: string; sections: Set<string>; editCount: number }> = {}
  let aiEdits = 0
  let tensions = 0

  for (const ev of events) {
    const ownerId = fileThreads.find((t) => t.id === ev.threadId)?.ownerId ?? 'unknown'
    if (!byOwner[ownerId]) {
      byOwner[ownerId] = { ownerId, sections: new Set(), editCount: 0 }
    }
    byOwner[ownerId].editCount++
    if (ev.type === 'ai_interaction') aiEdits++
    if ((ev.metadata as Record<string, unknown> | null)?.['tension']) tensions++
    const section = (ev.metadata as Record<string, unknown> | null)?.['section'] as
      | string
      | undefined
    if (section) byOwner[ownerId].sections.add(section)
  }

  // Look up names
  const ownerIds = Object.keys(byOwner).filter((id) => id !== 'unknown')
  const userRows =
    ownerIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ownerIds))
      : []
  const nameById = Object.fromEntries(userRows.map((u) => [u.id, u.name ?? 'Unknown']))

  const userSummaries = Object.values(byOwner).map((v) => ({
    name: nameById[v.ownerId] ?? 'Unknown',
    sections: Array.from(v.sections).slice(0, 5),
    editCount: v.editCount,
  }))

  return c.json({
    data: {
      hasChanges: events.length > 0,
      users: userSummaries,
      aiEdits,
      tensions,
      eventCount: events.length,
    },
    error: null,
  })
})

filesRouter.post('/:id/versions/:versionId/restore', async (c) => {
  const fileId = c.req.param('id')
  const versionId = c.req.param('versionId')
  const userId = c.get('userId')

  const [version] = await db.select().from(fileVersions).where(eq(fileVersions.id, versionId))

  if (!version) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Version not found' } }, 404)
  }

  const [file] = await db.select().from(files).where(eq(files.id, fileId))
  if (!file) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  const denied = await assertWorkspaceAccess(c, file.workspaceId)
  if (denied) return denied

  const newVersion = file.version + 1

  await db.insert(fileVersions).values({
    fileId,
    versionNumber: newVersion,
    storagePath: version.storagePath,
    sizeBytes: version.sizeBytes,
    createdBy: userId,
    diffSummary: `Restored from version ${version.versionNumber}`,
  })

  const [updated] = await db
    .update(files)
    .set({
      version: newVersion,
      storagePath: version.storagePath,
      sizeBytes: version.sizeBytes,
      updatedAt: new Date(),
    })
    .where(eq(files.id, fileId))
    .returning()

  return c.json({ data: updated, error: null })
})
