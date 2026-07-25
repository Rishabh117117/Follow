import { Hono } from 'hono'
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { files } from '../db/schema/files'
import { chatConversations, chatMessages } from '../db/schema/chat'
import { strands } from '../db/schema/threads'
import { evidenceRecords } from '../db/schema/semantic-index'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'

const searchRouter = new Hono()
searchRouter.use('*', authMiddleware)

searchRouter.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  const q = c.req.query('q')?.trim() ?? ''

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  if (!q) {
    return c.json({ data: { files: [], chats: [], notes: [], strands: [] }, error: null })
  }

  const pattern = `%${q}%`

  const [filesRes, chatsRes, strandsRes, notesRes] = await Promise.all([
    db
      .select({
        id: files.id,
        name: files.name,
        type: files.type,
        mimeType: files.mimeType,
        updatedAt: files.updatedAt,
      })
      .from(files)
      .where(
        and(
          eq(files.workspaceId, workspaceId),
          isNull(files.deletedAt),
          ilike(files.name, pattern),
          sql`(${files.metadata}->>'isTemplate' IS NULL OR (${files.metadata}->>'isTemplate')::boolean = false)`
        )
      )
      .orderBy(desc(files.updatedAt))
      .limit(5),

    db
      .select({
        id: chatMessages.id,
        conversationId: chatMessages.conversationId,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
        conversationTitle: chatConversations.title,
      })
      .from(chatMessages)
      .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
      .where(
        and(eq(chatConversations.workspaceId, workspaceId), ilike(chatMessages.content, pattern))
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(5),

    db
      .select({
        id: strands.id,
        name: strands.name,
        color: strands.color,
        lastActivityAt: strands.lastActivityAt,
      })
      .from(strands)
      .where(and(eq(strands.workspaceId, workspaceId), ilike(strands.name, pattern)))
      .orderBy(desc(strands.lastActivityAt))
      .limit(3),

    db
      .select({
        id: evidenceRecords.id,
        documentId: evidenceRecords.documentId,
        contentAfter: evidenceRecords.contentAfter,
        createdAt: evidenceRecords.createdAt,
      })
      .from(evidenceRecords)
      .where(
        and(
          eq(evidenceRecords.workspaceId, workspaceId),
          eq(evidenceRecords.evidenceType, 'user_clip'),
          ilike(evidenceRecords.contentAfter, pattern)
        )
      )
      .orderBy(desc(evidenceRecords.createdAt))
      .limit(3),
  ])

  return c.json({
    data: {
      files: filesRes.map((f) => ({
        id: f.id,
        title: f.name,
        subtitle: f.type,
        link: `/follow/doc/${f.id}`,
        updatedAt: f.updatedAt,
      })),
      chats: chatsRes.map((m) => ({
        id: m.id,
        title: m.conversationTitle ?? 'Chat',
        subtitle: m.content.slice(0, 80),
        link: `/chat/${m.conversationId}`,
        updatedAt: m.createdAt,
      })),
      notes: notesRes.map((n) => ({
        id: n.id,
        title: 'Clip',
        subtitle: (n.contentAfter ?? '').slice(0, 80),
        link: n.documentId ? `/follow/doc/${n.documentId}` : '/follow/notes',
        updatedAt: n.createdAt,
      })),
      strands: strandsRes.map((s) => ({
        id: s.id,
        title: s.name,
        subtitle: 'Strand',
        link: `/strand/${s.id}`,
        color: s.color,
        updatedAt: s.lastActivityAt,
      })),
    },
    error: null,
  })
})

export { searchRouter }
