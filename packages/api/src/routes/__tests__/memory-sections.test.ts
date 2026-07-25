import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set('userId', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    await next()
  }),
}))

// Simple in-memory mock "table"
const mockDb: { rows: Array<any> } = { rows: [] }

vi.mock('../../db/index', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(mockDb.rows),
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => ({
        returning: () => {
          const inserted = Array.isArray(v) ? v : [v]
          const withIds = inserted.map((row, i) => ({
            id: `section-${Date.now()}-${i}`,
            userId: row.userId,
            indexId: row.indexId,
            key: row.key,
            title: row.title,
            content: row.content ?? '',
            sortOrder: row.sortOrder ?? 0,
            updatedAt: new Date(),
            createdAt: new Date(),
          }))
          mockDb.rows.push(...withIds)
          return Promise.resolve(withIds)
        },
      }),
    }),
    update: () => ({
      set: (patch: any) => ({
        where: () => ({
          returning: () => {
            if (mockDb.rows.length === 0) return Promise.resolve([])
            const row = { ...mockDb.rows[0], ...patch }
            mockDb.rows[0] = row
            return Promise.resolve([row])
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => {
          if (mockDb.rows.length === 0) return Promise.resolve([])
          const row = mockDb.rows[0]
          mockDb.rows = []
          return Promise.resolve([{ id: row.id }])
        },
      }),
    }),
  },
}))

vi.mock('../../db/schema/memory-sections', () => ({
  memorySections: {
    id: 'id',
    userId: 'userId',
    indexId: 'indexId',
    sortOrder: 'sortOrder',
  },
}))

import { memorySectionsRouter } from '../memory-sections'
import { Hono } from 'hono'

describe('Memory Sections Routes (WIRE-1)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.rows = []
    app = new Hono()
    app.route('/api/memory', memorySectionsRouter)
  })

  it('GET returns seeded defaults when no sections exist', async () => {
    const res = await app.request('/api/memory/sections?indexId=personal')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(6) // 6 default sections
    const keys = body.data.map((s: any) => s.key)
    expect(keys).toContain('overview')
    expect(keys).toContain('differentiators')
    expect(keys).toContain('architecture')
    expect(keys).toContain('mcp-integration')
    expect(keys).toContain('thesis')
    expect(keys).toContain('status')
  })

  it('seeded defaults contain real v3 content (WIRE-2)', async () => {
    const res = await app.request('/api/memory/sections?indexId=personal')
    const body = (await res.json()) as any
    // Overview should contain the v3 tagline
    const overview = body.data.find((s: any) => s.key === 'overview')
    expect(overview.content).toContain('context sharing and tracking system')
    // Architecture should mention the three layers
    const arch = body.data.find((s: any) => s.key === 'architecture')
    expect(arch.content).toContain('Three layers')
    // MCP Integration should list 9 tools
    const mcp = body.data.find((s: any) => s.key === 'mcp-integration')
    expect(mcp.content).toContain('9 tools')
  })

  it('GET requires indexId query param', async () => {
    const res = await app.request('/api/memory/sections')
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error.message).toContain('indexId')
  })

  it('GET returns existing sections when present (no re-seed)', async () => {
    // Pre-populate mock
    mockDb.rows = [
      {
        id: 'sec-1',
        userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        indexId: 'personal',
        key: 'overview',
        title: 'Overview',
        content: 'Existing content',
        sortOrder: 0,
      },
    ]
    const res = await app.request('/api/memory/sections?indexId=personal')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data).toHaveLength(1)
    expect(body.data[0].content).toBe('Existing content')
  })

  it('POST creates a new section', async () => {
    const res = await app.request('/api/memory/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexId: 'personal',
        key: 'custom',
        title: 'Custom Section',
        content: 'My content',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.data.title).toBe('Custom Section')
    expect(body.data.content).toBe('My content')
  })

  it('PATCH updates content and title', async () => {
    mockDb.rows = [
      {
        id: 'sec-1',
        userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        indexId: 'personal',
        key: 'overview',
        title: 'Overview',
        content: 'Original',
        sortOrder: 0,
      },
    ]
    const res = await app.request('/api/memory/sections/sec-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Updated content' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data.content).toBe('Updated content')
  })

  it('DELETE removes section', async () => {
    mockDb.rows = [
      {
        id: 'sec-1',
        userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        indexId: 'personal',
        key: 'overview',
        title: 'Overview',
        content: '',
        sortOrder: 0,
      },
    ]
    const res = await app.request('/api/memory/sections/sec-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data.deleted).toBe(true)
  })

  it('POST validates required fields', async () => {
    const res = await app.request('/api/memory/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indexId: 'personal' }),
    })
    expect(res.status).toBe(400)
  })
})
