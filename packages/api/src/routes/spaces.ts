import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, isNull, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index'
import { spaces, spaceDocuments } from '../db/schema/spaces'
import { files } from '../db/schema/files'
import { externalDocuments } from '../db/schema/external-documents'
import { chatConversations } from '../db/schema/chat'
import { users } from '../db/schema/users'
import { strandThreadRefs, threadEvents } from '../db/schema/threads'
import { authMiddleware } from '../middleware/auth'
import {
  ensureProjectStrand,
  linkDocumentToProjectStrand,
  unlinkDocumentFromProjectStrand,
} from '../services/project-strand-manager'
import { EventBus } from '../events/EventBus'

const spacesRouter = new Hono()
spacesRouter.use('*', authMiddleware)

// ─── Schemas ───────────────────────────────────────────────────────

const CreateSpaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  isProject: z.boolean().optional(),
})

const UpdateSpaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(10).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
})

const AddDocumentSchema = z.object({
  externalDocumentId: z.string().uuid().optional(),
  fileId: z.string().uuid().optional(),
}).refine(
  (d) => d.externalDocumentId || d.fileId,
  { message: 'Either externalDocumentId or fileId is required' }
)

// ─── Create Space ──────────────────────────────────────────────────

spacesRouter.post('/', zValidator('json', CreateSpaceSchema), async (c) => {
  const body = c.req.valid('json')
  const userId = c.get('userId')

  // 1. Create the canvas file for this space
  const [canvasFile] = await db
    .insert(files)
    .values({
      workspaceId: body.workspaceId,
      name: `${body.name} Canvas`,
      type: 'file',
      mimeType: 'application/vnd.workspace.canvas',
      metadata: { editorType: 'canvas' },
      createdBy: userId,
    })
    .returning()

  // 2. Create the space with linked canvas
  const [space] = await db
    .insert(spaces)
    .values({
      workspaceId: body.workspaceId,
      name: body.name,
      description: body.description ?? null,
      canvasFileId: canvasFile!.id,
      icon: body.icon ?? null,
      color: body.color ?? null,
      isProject: body.isProject ?? false,
      createdBy: userId,
    })
    .returning()

  // 3. Link the canvas file to the space
  await db.update(files).set({ spaceId: space!.id }).where(eq(files.id, canvasFile!.id))

  // 4. If project, create project strand
  if (body.isProject) {
    const { strandId } = await ensureProjectStrand(
      body.workspaceId,
      userId,
      space!.id,
      body.name
    )
    await db
      .update(spaces)
      .set({ strandId, updatedAt: new Date() })
      .where(eq(spaces.id, space!.id))
    ;(space as any).strandId = strandId
  }

  // 5. Emit timeline event
  await EventBus.emit({
    workspaceId: body.workspaceId,
    userId,
    actionType: body.isProject ? 'project_created' : 'space_created',
    objectType: 'space',
    objectId: space!.id,
    payload: { name: body.name, isProject: body.isProject ?? false },
  })

  return c.json({ data: { ...space!, canvasFile: canvasFile! }, error: null }, 201)
})

// ─── List Spaces ───────────────────────────────────────────────────

spacesRouter.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  const isProject = c.req.query('isProject')

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  let query = db
    .select()
    .from(spaces)
    .where(and(eq(spaces.workspaceId, workspaceId), isNull(spaces.deletedAt)))
    .orderBy(desc(spaces.updatedAt))

  const results = await query

  // Filter by isProject if specified
  const filtered = isProject !== undefined
    ? results.filter((s) => s.isProject === (isProject === 'true'))
    : results

  return c.json({ data: filtered, error: null })
})

// ─── Get Space (with canvas info + recent conversations + documents) ──

spacesRouter.get('/:id', async (c) => {
  const spaceId = c.req.param('id')

  const [space] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)))

  if (!space) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
  }

  // Fetch the canvas file
  let canvasFile = null
  if (space.canvasFileId) {
    const [cf] = await db.select().from(files).where(eq(files.id, space.canvasFileId))
    canvasFile = cf ?? null
  }

  // Fetch conversations belonging to this space, joined with the owning
  // user's display name + avatar so the Members card can render real names
  // without a separate /api/users batch lookup.
  const conversationRows = await db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      userId: chatConversations.userId,
      spaceId: chatConversations.spaceId,
      workspaceId: chatConversations.workspaceId,
      metadata: chatConversations.metadata,
      status: chatConversations.status,
      createdAt: chatConversations.createdAt,
      updatedAt: chatConversations.updatedAt,
      userName: users.name,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
      userImage: users.image,
    })
    .from(chatConversations)
    .leftJoin(users, eq(users.id, chatConversations.userId))
    .where(and(eq(chatConversations.spaceId, spaceId), eq(chatConversations.status, 'active')))
    .orderBy(desc(chatConversations.updatedAt))

  const conversations = conversationRows.map((r) => ({
    ...r,
    user: {
      id: r.userId,
      name: r.userName,
      email: r.userEmail,
      avatarUrl: r.userAvatar ?? r.userImage ?? null,
    },
  }))

  // If project, fetch linked documents
  let documents: any[] = []
  if (space.isProject) {
    const spaceDocs = await db
      .select()
      .from(spaceDocuments)
      .where(eq(spaceDocuments.spaceId, spaceId))

    for (const sd of spaceDocs) {
      if (sd.fileId) {
        const [f] = await db.select().from(files).where(eq(files.id, sd.fileId))
        if (f) {
          documents.push({
            id: sd.id,
            spaceId: sd.spaceId,
            fileId: f.id,
            externalDocumentId: null,
            title: f.name,
            docType: 'internal',
            addedAt: sd.addedAt,
          })
        }
      }
      if (sd.externalDocumentId) {
        const [ed] = await db
          .select()
          .from(externalDocuments)
          .where(eq(externalDocuments.id, sd.externalDocumentId))
        if (ed) {
          documents.push({
            id: sd.id,
            spaceId: sd.spaceId,
            fileId: null,
            externalDocumentId: ed.id,
            title: ed.title,
            docType: ed.docType,
            strandId: ed.strandId,
            addedAt: sd.addedAt,
          })
        }
      }
    }
  }

  return c.json({
    data: {
      ...space,
      canvasFile,
      conversations,
      documents,
    },
    error: null,
  })
})

// ─── Update Space ──────────────────────────────────────────────────

spacesRouter.patch('/:id', zValidator('json', UpdateSpaceSchema), async (c) => {
  const spaceId = c.req.param('id')
  const body = c.req.valid('json')

  const [updated] = await db
    .update(spaces)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)))
    .returning()

  if (!updated) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
  }

  return c.json({ data: updated, error: null })
})

// ─── Delete Space (soft) ───────────────────────────────────────────

spacesRouter.delete('/:id', async (c) => {
  const spaceId = c.req.param('id')
  const userId = c.get('userId')

  const [deleted] = await db
    .update(spaces)
    .set({ deletedAt: new Date() })
    .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)))
    .returning()

  if (!deleted) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
  }

  await EventBus.emit({
    workspaceId: deleted.workspaceId,
    userId,
    actionType: 'space_deleted',
    objectType: 'space',
    objectId: spaceId,
    payload: { name: deleted.name },
  })

  return c.json({ data: { id: spaceId }, error: null })
})

// ─── Add Document to Project ───────────────────────────────────────

spacesRouter.post(
  '/:id/documents',
  zValidator('json', AddDocumentSchema),
  async (c) => {
    const spaceId = c.req.param('id')
    const userId = c.get('userId')
    const body = c.req.valid('json')

    // Verify space exists and is a project
    const [space] = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)))

    if (!space) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
    }

    if (!space.isProject) {
      return c.json(
        { data: null, error: { code: 'BAD_REQUEST', message: 'Space is not a project' } },
        400
      )
    }

    // Ensure project strand exists
    if (!space.strandId) {
      const { strandId } = await ensureProjectStrand(
        space.workspaceId,
        userId,
        spaceId,
        space.name
      )
      await db
        .update(spaces)
        .set({ strandId, updatedAt: new Date() })
        .where(eq(spaces.id, spaceId))
      space.strandId = strandId
    }

    // Insert space_documents record
    const [spaceDoc] = await db
      .insert(spaceDocuments)
      .values({
        spaceId,
        externalDocumentId: body.externalDocumentId ?? null,
        fileId: body.fileId ?? null,
        addedBy: userId,
      })
      .onConflictDoNothing()
      .returning()

    if (!spaceDoc) {
      return c.json({ data: null, error: { code: 'CONFLICT', message: 'Document already in project' } }, 409)
    }

    // Link document strand threads to project strand (if document has a strand)
    let documentStrandId: string | null = null

    if (body.externalDocumentId) {
      const [ed] = await db
        .select()
        .from(externalDocuments)
        .where(eq(externalDocuments.id, body.externalDocumentId))
      documentStrandId = ed?.strandId ?? null
    }

    if (documentStrandId && space.strandId) {
      await linkDocumentToProjectStrand(space.strandId, documentStrandId, userId)
    }

    return c.json({ data: spaceDoc, error: null }, 201)
  }
)

// ─── Remove Document from Project ──────────────────────────────────

spacesRouter.delete('/:id/documents/:docId', async (c) => {
  const spaceId = c.req.param('id')
  const docId = c.req.param('docId')

  // Get space for project strand
  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceId))

  // Get the space_documents record to find the document strand
  const [spaceDoc] = await db
    .select()
    .from(spaceDocuments)
    .where(eq(spaceDocuments.id, docId))

  if (!spaceDoc) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Document not found in project' } }, 404)
  }

  // Unlink document strand threads from project strand
  if (space?.strandId && spaceDoc.externalDocumentId) {
    const [ed] = await db
      .select()
      .from(externalDocuments)
      .where(eq(externalDocuments.id, spaceDoc.externalDocumentId))
    if (ed?.strandId) {
      await unlinkDocumentFromProjectStrand(space.strandId, ed.strandId)
    }
  }

  await db.delete(spaceDocuments).where(eq(spaceDocuments.id, docId))

  return c.json({ data: { id: docId }, error: null })
})

// ─── List Project Documents ────────────────────────────────────────

spacesRouter.get('/:id/documents', async (c) => {
  const spaceId = c.req.param('id')

  const spaceDocs = await db
    .select()
    .from(spaceDocuments)
    .where(eq(spaceDocuments.spaceId, spaceId))

  const results: any[] = []

  for (const sd of spaceDocs) {
    if (sd.fileId) {
      const [f] = await db.select().from(files).where(eq(files.id, sd.fileId))
      if (f) {
        results.push({
          id: sd.id,
          spaceId: sd.spaceId,
          fileId: f.id,
          externalDocumentId: null,
          title: f.name,
          docType: 'internal',
          addedAt: sd.addedAt,
        })
      }
    }
    if (sd.externalDocumentId) {
      const [ed] = await db
        .select()
        .from(externalDocuments)
        .where(eq(externalDocuments.id, sd.externalDocumentId))
      if (ed) {
        results.push({
          id: sd.id,
          spaceId: sd.spaceId,
          fileId: null,
          externalDocumentId: ed.id,
          title: ed.title,
          docType: ed.docType,
          strandId: ed.strandId,
          addedAt: sd.addedAt,
        })
      }
    }
  }

  return c.json({ data: results, error: null })
})

// ─── Project Activity Feed ─────────────────────────────────────────

spacesRouter.get('/:id/activity', async (c) => {
  const spaceId = c.req.param('id')
  const limit = parseInt(c.req.query('limit') ?? '50')

  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceId))

  if (!space?.strandId) {
    return c.json({ data: [], error: null })
  }

  // Get all threads in the project strand
  const refs = await db
    .select({ threadId: strandThreadRefs.threadId })
    .from(strandThreadRefs)
    .where(eq(strandThreadRefs.strandId, space.strandId))

  if (refs.length === 0) {
    return c.json({ data: [], error: null })
  }

  const threadIds = refs.map((r) => r.threadId)

  // Get recent events from all project threads
  const events = await db
    .select()
    .from(threadEvents)
    .where(inArray(threadEvents.threadId, threadIds))
    .orderBy(desc(threadEvents.time))
    .limit(limit)

  return c.json({ data: events, error: null })
})

export { spacesRouter }
