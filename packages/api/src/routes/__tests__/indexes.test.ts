import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set('userId', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    await next()
  }),
}))

vi.mock('../../services/project-strand-manager', () => ({
  ensureProjectStrand: vi.fn().mockResolvedValue(undefined),
}))

const mockSpaces: Array<any> = []

vi.mock('../../db/index', () => ({
  db: {
    select: (shape: any) => ({
      from: (table: any) => ({
        where: (_cond: any) => {
          // When counting, return [{ cnt: 0 }]
          if (shape && 'cnt' in shape) return Promise.resolve([{ cnt: 0 }])
          // Return space rows if selecting from spaces
          const tableName = String(table?.[Symbol.for('drizzle:Name')] ?? '')
          if (tableName.includes('space') || table === undefined) return Promise.resolve(mockSpaces)
          return Promise.resolve([])
        },
      }),
    }),
    selectDistinct: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: (vals: any) => ({
        returning: () =>
          Promise.resolve([
            {
              id: 'new-space-uuid',
              workspaceId: vals.workspaceId,
              name: vals.name,
              isProject: true,
              createdBy: vals.createdBy,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
      }),
    }),
  },
}))

vi.mock('../../db/schema/spaces', () => ({
  spaces: {
    id: 'id',
    createdBy: 'createdBy',
    isProject: 'isProject',
    deletedAt: 'deletedAt',
    [Symbol.for('drizzle:Name')]: 'spaces',
  },
  spaceDocuments: {},
}))
vi.mock('../../db/schema/raw-files', () => ({
  rawFiles: {
    userId: 'userId',
    deletedAt: 'deletedAt',
    [Symbol.for('drizzle:Name')]: 'raw_files',
  },
}))
vi.mock('../../db/schema/chat', () => ({
  chatConversations: {
    userId: 'userId',
    spaceId: 'spaceId',
    id: 'id',
    [Symbol.for('drizzle:Name')]: 'chat_conversations',
  },
}))
vi.mock('../../db/schema/semantic-index', () => ({
  indexRecords: {
    userId: 'userId',
    threadId: 'threadId',
    [Symbol.for('drizzle:Name')]: 'index_records',
  },
}))
vi.mock('../../db/schema/files', () => ({
  files: {
    spaceId: 'spaceId',
    deletedAt: 'deletedAt',
    id: 'id',
    [Symbol.for('drizzle:Name')]: 'files',
  },
}))

import { indexesRouter } from '../indexes'
import { Hono } from 'hono'

describe('Indexes Routes (WIRE-1)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/api/indexes', indexesRouter)
  })

  it('GET /api/indexes returns personal index', async () => {
    const res = await app.request('/api/indexes')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
    // Should always include Personal
    const personal = body.data.find((i: any) => i.id === 'personal')
    expect(personal).toBeDefined()
    expect(personal.type).toBe('personal')
    expect(personal.name).toBe('Personal')
  })

  it('personal index has numeric fact/file/chat counts', async () => {
    const res = await app.request('/api/indexes')
    const body = (await res.json()) as any
    const personal = body.data.find((i: any) => i.id === 'personal')
    expect(typeof personal.facts).toBe('number')
    expect(typeof personal.files).toBe('number')
    expect(typeof personal.chats).toBe('number')
  })

  it('POST /api/indexes creates a new project space', async () => {
    const res = await app.request('/api/indexes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'My Project',
        type: 'project',
        workspaceId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.data.id).toBe('new-space-uuid')
    expect(body.data.name).toBe('My Project')
    expect(body.data.type).toBe('project')
    expect(body.data.members).toBe(1)
  })

  it('POST /api/indexes rejects duplicate personal index', async () => {
    const res = await app.request('/api/indexes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Personal 2', type: 'personal' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error.message).toContain('Personal index already exists')
  })

  it('POST /api/indexes validates name is required', async () => {
    const res = await app.request('/api/indexes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'project', workspaceId: 'c3d4e5f6-a7b8-9012-cdef-123456789012' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/indexes requires workspaceId for project type', async () => {
    const res = await app.request('/api/indexes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Project', type: 'project' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error.message).toContain('workspaceId')
  })
})
