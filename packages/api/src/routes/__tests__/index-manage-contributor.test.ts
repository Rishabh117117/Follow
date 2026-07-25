import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set('userId', 'user-self')
    c.set('workspaceId', '11111111-1111-1111-1111-111111111111')
    await next()
  }),
}))

const { mockByContribRows } = vi.hoisted(() => ({ mockByContribRows: vi.fn() }))

vi.mock('../../db/index', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(mockByContribRows())),
        })),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue({}) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue({}) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })) })),
  },
}))

vi.mock('../../db/schema/semantic-index', () => ({
  indexRecords: {
    userId: 'userId',
    userName: 'userName',
    threadType: 'threadType',
    sourceFileId: 'sourceFileId',
    indexedAt: 'indexedAt',
    hidden: 'hidden',
    id: 'id',
  },
}))

vi.mock('../../db/schema/raw-files', () => ({ rawFiles: {} }))
vi.mock('../../db/schema/chat', () => ({ chatConversations: {}, chatMessages: {} }))
vi.mock('../../services/raw-file-store', () => ({ storeRawFile: vi.fn() }))
vi.mock('../../services/indexing/file-indexer', () => ({ queueFileIndex: vi.fn() }))

import { indexManageRouter } from '../index-manage'
import { Hono } from 'hono'

function mkApp() {
  const app = new Hono()
  app.route('/', indexManageRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mockByContribRows.mockReturnValue([
    {
      userId: 'user-a',
      userName: 'Alice',
      threadType: 'doc',
      sourceFileId: 'f1',
      indexedAt: new Date('2026-04-10T10:00:00Z'),
    },
    {
      userId: 'user-a',
      userName: 'Alice',
      threadType: 'ai',
      sourceFileId: null,
      indexedAt: new Date('2026-04-11T10:00:00Z'),
    },
    {
      userId: 'user-b',
      userName: 'Bob',
      threadType: 'doc',
      sourceFileId: null,
      indexedAt: new Date('2026-04-09T10:00:00Z'),
    },
  ])
})

describe('GET /by-contributor (Sprint CTX-2)', () => {
  it('returns grouped contributor list', async () => {
    const res = await mkApp().request('/by-contributor', { method: 'GET' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(Array.isArray(body.data.contributors)).toBe(true)
    expect(body.data.contributors.length).toBe(2)
  })

  it('computes correct fact and file counts per contributor', async () => {
    const res = await mkApp().request('/by-contributor', { method: 'GET' })
    const body = (await res.json()) as any
    const alice = body.data.contributors.find((c: any) => c.userId === 'user-a')
    expect(alice.factCount).toBe(2)
    expect(alice.fileCount).toBe(1)
  })

  it('returns contributors sorted by latestAt descending', async () => {
    const res = await mkApp().request('/by-contributor', { method: 'GET' })
    const body = (await res.json()) as any
    const ids = body.data.contributors.map((c: any) => c.userId)
    expect(ids[0]).toBe('user-a') // latest 2026-04-11 > Bob's 2026-04-09
  })
})
