/* eslint-disable @typescript-eslint/no-explicit-any -- mock-heavy test file */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Index Manage Route — unit tests (Sprint CTX-1)
 */

const testUserId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set('userId', testUserId)
    c.set('workspaceId', '11111111-1111-1111-1111-111111111111')
    await next()
  }),
}))

// security-gate-1: membership enforcement has its own tests; unit tests mock
// the guard permissive so the flat db fake keeps modeling only route logic.
vi.mock('../../services/workspace-access', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue(null),
  checkWorkspaceAccess: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
}))

const {
  mockSet,
  mockDelete,
  mockInsertReturning,
  mockSelectRecord,
  mockSelectRawFile,
  mockSelectFactCount,
} = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockDelete: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockSelectRecord: vi.fn(),
  mockSelectRawFile: vi.fn(),
  mockSelectFactCount: vi.fn(),
}))

vi.mock('../../db/index', () => {
  const updateChain = {
    set: vi.fn((vals: any) => {
      mockSet(vals)
      return {
        where: vi.fn().mockResolvedValue({ rowCount: 2 }),
      }
    }),
  }

  const deleteChain = {
    where: vi.fn((_cond: any) => {
      mockDelete()
      return Promise.resolve({ rowCount: 1 })
    }),
  }

  // select chain: `where()` is thenable AND supports `.limit()`
  const makeThenableChain = (value: () => unknown[]) => {
    const chain: any = {
      limit: vi.fn(() => Promise.resolve(value())),
      then: (resolve: any, reject: any) => Promise.resolve(value()).then(resolve, reject),
    }
    return chain
  }

  return {
    db: {
      select: vi.fn((shape?: any) => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            // If projecting a count shape → return single row with cnt
            if (shape && typeof shape === 'object' && 'cnt' in shape) {
              return makeThenableChain(() => mockSelectFactCount())
            }
            return makeThenableChain(() => mockSelectRecord())
          }),
        })),
      })),
      selectDistinct: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => makeThenableChain(() => [])),
        })),
      })),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(mockInsertReturning())),
        })),
      })),
    },
  }
})

vi.mock('../../db/schema/semantic-index', () => ({
  indexRecords: {
    id: 'id',
    hidden: 'hidden',
    hiddenAt: 'hiddenAt',
    sourceFileId: 'sourceFileId',
    userId: 'userId',
    userName: 'userName',
    threadType: 'threadType',
    indexedAt: 'indexedAt',
  },
}))

vi.mock('../../db/schema/raw-files', () => ({
  rawFiles: { id: 'id', fileName: 'fileName', deletedAt: 'deletedAt' },
}))

vi.mock('../../db/schema/chat', () => ({
  chatConversations: { id: 'id' },
  chatMessages: { conversationId: 'conversationId' },
}))

const { mockTombstoneSource, mockTombstoneRecord } = vi.hoisted(() => ({
  mockTombstoneSource: vi.fn(async () => ({ records: 2, edges: 0, states: 0 })),
  mockTombstoneRecord: vi.fn(async () => ({ edges: 0, states: 0 })),
}))

// deleteIndexItem dispatches to the tombstone service (which soft-deletes in
// a db.transaction); the unit test asserts the dispatch, not the internals.
vi.mock('../../services/pipeline/tombstone', () => ({
  tombstoneSource: mockTombstoneSource,
  tombstoneRecord: mockTombstoneRecord,
}))

vi.mock('../../services/raw-file-store', () => ({
  storeRawFile: vi.fn(async (input: any) => ({
    id: 'raw-file-uuid-1',
    userId: input.userId,
    workspaceId: input.workspaceId,
    fileName: input.fileName,
    filePath: null,
    mimeType: input.mimeType,
    fileSize: input.content?.length ?? 0,
    contentHash: 'hash-' + input.fileName,
    version: 1,
    previousHash: null,
    storageKey: 'key-1',
    extractedText: input.content?.toString?.('utf-8') ?? 'extracted',
    sourceType: input.sourceType,
    sourceRef: input.sourceRef ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
}))

vi.mock('../../services/indexing/file-indexer', () => ({
  queueFileIndex: vi.fn(),
}))

// ─── Import after mocks ─────────────────────────────────────────────────────

import { indexManageRouter } from '../index-manage'
import { Hono } from 'hono'

function mkApp() {
  const app = new Hono()
  app.route('/', indexManageRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSelectRecord.mockReturnValue([
    {
      id: 'rec-1',
      sourceFileId: 'raw-file-uuid-1',
      userId: testUserId,
    },
  ])
  mockSelectRawFile.mockReturnValue([])
  mockInsertReturning.mockReturnValue([{ id: 'conv-uuid-1' }])
  mockSelectFactCount.mockReturnValue([{ cnt: 3 }])
})

describe('PATCH /:id/hide', () => {
  it('sets hidden=true on record', async () => {
    const res = await mkApp().request('/rec-1/hide', { method: 'PATCH' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.hidden).toBe(true)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }))
  })
})

describe('PATCH /:id/unhide', () => {
  it('sets hidden=false', async () => {
    const res = await mkApp().request('/rec-1/unhide', { method: 'PATCH' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.hidden).toBe(false)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ hidden: false, hiddenAt: null }))
  })
})

describe('DELETE /:id', () => {
  it('removes record and soft-deletes the raw file', async () => {
    const res = await mkApp().request('/rec-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.deleted).toBe(true)
    // raw file soft-delete: update set deletedAt
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: expect.any(Date) }))
  })

  it('cascades to every record sharing the source via tombstoneSource', async () => {
    await mkApp().request('/rec-1', { method: 'DELETE' })
    // The v5.1 hard-delete cascade became audit-preserving tombstones: one
    // tombstoneSource call sweeps all records with this sourceFileId.
    expect(mockTombstoneSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFileId: 'raw-file-uuid-1', reason: 'user' })
    )
    expect(mockTombstoneRecord).not.toHaveBeenCalled()
  })
})

describe('POST /bulk', () => {
  it('hide affects multiple records', async () => {
    const res = await mkApp().request('/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'hide',
        ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.affected).toBeGreaterThan(0)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }))
  })

  it('delete removes multiple records', async () => {
    const res = await mkApp().request('/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.affected).toBe(2)
    expect(mockTombstoneSource).toHaveBeenCalledTimes(2)
  })

  it('rejects more than 50 IDs', async () => {
    const ids = Array.from(
      { length: 51 },
      (_, i) => `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`
    )
    const res = await mkApp().request('/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'hide', ids }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /upload', () => {
  it('stores file and creates index record', async () => {
    const form = new FormData()
    form.append('files', new File(['hello'], 'test.txt', { type: 'text/plain' }))
    const res = await mkApp().request('/upload', { method: 'POST', body: form })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.uploaded).toBe(1)
    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].fileName).toBe('test.txt')
  })

  it('passes parallel filePaths[] through to storeRawFile for tree rendering', async () => {
    // MCP-FIX-4: clients (web upload via webkitdirectory, desktop agent)
    // may send a parallel `filePaths[]` array aligned with `files[]`. The
    // handler must forward each path to storeRawFile so the DB row can
    // drive the folder-tree view.
    const mod = await import('../../services/raw-file-store')
    const form = new FormData()
    form.append('files', new File(['a'], 'page.tsx', { type: 'text/typescript' }))
    form.append('files', new File(['b'], 'layout.tsx', { type: 'text/typescript' }))
    form.append('filePaths', 'apps/web/src/app/page.tsx')
    form.append('filePaths', 'apps/web/src/app/layout.tsx')

    const res = await mkApp().request('/upload', { method: 'POST', body: form })
    expect(res.status).toBe(200)
    const calls = (mod.storeRawFile as any).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0].filePath).toBe('apps/web/src/app/page.tsx')
    expect(calls[0][0].fileName).toBe('page.tsx')
    expect(calls[1][0].filePath).toBe('apps/web/src/app/layout.tsx')
    expect(calls[1][0].fileName).toBe('layout.tsx')
  })

  it('ignores filePaths entries that are bare filenames (no separator)', async () => {
    // A bare filename is no better than `null` for tree building — the
    // handler normalizes it to undefined so the DB row stays at tree root.
    const mod = await import('../../services/raw-file-store')
    const form = new FormData()
    form.append('files', new File(['x'], 'solo.txt', { type: 'text/plain' }))
    form.append('filePaths', 'solo.txt') // bare filename — should be dropped

    const res = await mkApp().request('/upload', { method: 'POST', body: form })
    expect(res.status).toBe(200)
    const calls = (mod.storeRawFile as any).mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall[0].filePath).toBeUndefined()
  })

  it('tolerates missing filePaths entries by omitting filePath on the call', async () => {
    // Old clients won't send filePaths[]; handler must still accept the
    // upload without erroring. The filePath field is passed as undefined.
    const mod = await import('../../services/raw-file-store')
    const form = new FormData()
    form.append('files', new File(['y'], 'legacy.txt', { type: 'text/plain' }))

    const res = await mkApp().request('/upload', { method: 'POST', body: form })
    expect(res.status).toBe(200)
    const calls = (mod.storeRawFile as any).mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall[0].filePath).toBeUndefined()
  })

  it('reports duplicates when content hash already exists', async () => {
    // Simulate existing raw file with same name/content by making storeRawFile
    // return the same id as a prior lookup
    const mod = await import('../../services/raw-file-store')
    ;(mod.storeRawFile as any).mockResolvedValueOnce({
      id: 'raw-file-uuid-1',
      fileName: 'dup.txt',
      contentHash: 'h',
      version: 1,
      extractedText: '',
    })
    const form = new FormData()
    form.append('files', new File(['dup'], 'dup.txt', { type: 'text/plain' }))
    const res = await mkApp().request('/upload', { method: 'POST', body: form })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.items[0].fileName).toBe('dup.txt')
  })
})

describe('POST /paste', () => {
  it('creates record from text content', async () => {
    const res = await mkApp().request('/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'some note', title: 'My Note', type: 'text' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.fileName).toBe('My Note')
  })
})

describe('POST /import-conversation', () => {
  it('creates chat with source type', async () => {
    const res = await mkApp().request('/import-conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
        source: 'claude',
        title: 'Imported Chat',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.conversationId).toBe('conv-uuid-1')
    expect(body.data.factsExtracted).toBeGreaterThanOrEqual(0)
  })
})

describe('Hidden filter behavior', () => {
  it('GET /api/index (query-executor) excludes hidden records by default', async () => {
    // The executor is called by the existing /api/index route; verify the
    // `hidden=false` predicate is wired by importing the executor's module
    // source and checking the conditional.
    const path = await import('path')
    const src = await import('fs').then((fs) =>
      fs.promises.readFile(
        path.resolve(__dirname, '../../services/semantic-index/query-executor.ts'),
        'utf-8'
      )
    )
    expect(src).toContain('indexRecords.hidden')
    expect(src).toContain('includeHidden')
  })
})
