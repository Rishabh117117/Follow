/* eslint-disable @typescript-eslint/no-explicit-any -- mock-heavy test file */
import { describe, it, expect, vi, beforeAll } from 'vitest'

// MEM-1 rewrote /api/memory/sections as a profile/version system, so these
// tests run against the real dev DB (PGlite) instead of a hand-rolled db
// mock — the route now spans profile-store, section-generator, and
// index-digest, which a flat fake cannot model. Only auth is mocked.
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set('userId', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    await next()
  }),
}))

import { Hono } from 'hono'
import { memorySectionsRouter } from '../memory-sections'
import { db, waitForDb } from '../../db/index'
import { users } from '../../db/schema/index'

const UID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const INDEX_ID = 'mem1-route-test-index'

function mkApp() {
  const app = new Hono()
  app.route('/api/memory', memorySectionsRouter)
  return app
}

async function getSections() {
  const res = await mkApp().request(`/api/memory/sections?indexId=${INDEX_ID}`)
  const body = (await res.json()) as any
  return { res, body }
}

describe('Memory Sections Routes (MEM-1)', () => {
  beforeAll(async () => {
    await waitForDb()
    await db
      .insert(users)
      .values({ id: UID, email: 'mem-route-test@follow.test', name: 'Mem Route Test' })
      .onConflictDoNothing()
  }, 30_000)

  it('GET seeds built-in profiles and returns the default profile sections', async () => {
    const { res, body } = await getSections()
    expect(res.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
    for (const s of body.data) {
      expect(typeof s.key).toBe('string')
      expect(typeof s.title).toBe('string')
      expect(typeof s.content).toBe('string')
    }
  })

  it('GET requires indexId query param', async () => {
    const res = await mkApp().request('/api/memory/sections')
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error.message).toContain('indexId')
  })

  it('second GET reuses the seeded version (no re-seed)', async () => {
    const first = await getSections()
    const second = await getSections()
    expect(second.res.status).toBe(200)
    const firstIds = first.body.data.map((s: any) => s.id).sort()
    const secondIds = second.body.data.map((s: any) => s.id).sort()
    expect(secondIds).toEqual(firstIds)
  })

  it('POST creates a new section', async () => {
    const res = await mkApp().request('/api/memory/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexId: INDEX_ID,
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

  it('PATCH updates a legacy (unversioned) section in place', async () => {
    const created = await mkApp().request('/api/memory/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexId: INDEX_ID,
        key: 'patch-legacy',
        title: 'Patch Legacy',
        content: 'Original',
      }),
    })
    const createdBody = (await created.json()) as any
    const res = await mkApp().request(`/api/memory/sections/${createdBody.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Updated content' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data.content).toBe('Updated content')
  })

  it('PATCH forks a new version for a versioned section', async () => {
    const { body: before } = await getSections()
    const target = before.data[0]
    const res = await mkApp().request(`/api/memory/sections/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Edited via fork' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data.section.content).toBe('Edited via fork')
    expect(body.data.versionNumber).toBeGreaterThan(1)
    // The forked version is now what GET serves.
    const { body: after } = await getSections()
    const edited = after.data.find((s: any) => s.key === target.key)
    expect(edited.content).toBe('Edited via fork')
  })

  it('DELETE removes a section', async () => {
    const created = await mkApp().request('/api/memory/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexId: INDEX_ID,
        key: 'delete-me',
        title: 'Delete Me',
        content: '',
      }),
    })
    const createdBody = (await created.json()) as any
    const res = await mkApp().request(`/api/memory/sections/${createdBody.data.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data.deleted).toBe(true)
  })

  it('POST validates required fields', async () => {
    const res = await mkApp().request('/api/memory/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indexId: INDEX_ID }),
    })
    expect(res.status).toBe(400)
  })
})
