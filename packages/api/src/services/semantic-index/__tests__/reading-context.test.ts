import { describe, it, expect, vi } from 'vitest'

// Mock ClickHouse — use in-memory fallback behavior
vi.mock('../../../db/clickhouse', () => ({
  clickhouse: {
    query: vi.fn().mockRejectedValue(new Error('ClickHouse unavailable in test')),
  },
}))

import { getReadingContext } from '../reading-context'

describe('ReadingContext', () => {
  it('returns default context when ClickHouse unavailable', async () => {
    const ctx = await getReadingContext('ws-1', 'user-1', 'doc-1', new Date().toISOString())
    expect(ctx.sectionBeingViewed).toBeNull()
    expect(ctx.viewDurationSeconds).toBe(0)
    expect(ctx.cursorPosition).toBeNull()
    expect(ctx.collaboratorsPresent).toEqual([])
  })

  it('returns default context with null documentId', async () => {
    const ctx = await getReadingContext('ws-1', 'user-1', null, new Date().toISOString())
    expect(ctx.viewDurationSeconds).toBe(0)
  })

  it('returns correct default shape', async () => {
    const ctx = await getReadingContext('ws-1', 'user-1', 'doc-1', '2026-01-01T00:00:00Z')
    expect(ctx).toHaveProperty('sectionBeingViewed')
    expect(ctx).toHaveProperty('viewDurationSeconds')
    expect(ctx).toHaveProperty('cursorPosition')
    expect(ctx).toHaveProperty('collaboratorsPresent')
  })
})
