import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { parseQueryFromNL } from '../nl-parser'

describe('nl-parser fallback behavior (no OPENROUTER_API_KEY)', () => {
  const originalKey = process.env.OPENROUTER_API_KEY

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY
  })

  afterEach(() => {
    if (originalKey) process.env.OPENROUTER_API_KEY = originalKey
    else delete process.env.OPENROUTER_API_KEY
  })

  it('returns a minimal query with topic match + warning when LLM unavailable', async () => {
    const r = await parseQueryFromNL({
      text: 'what did priya say last week',
      userId: 'u',
      workspaceId: 'w',
    })
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.warnings[0]).toMatch(/OPENROUTER_API_KEY|parsing/i)
    // Fallback builds a topic:matches boundary from the raw text.
    expect(
      r.query.boundaries.some((b) => b.dimension === 'topic' && b.op === 'matches')
    ).toBe(true)
  })

  it('returns an empty boundaries list when text is empty', async () => {
    const r = await parseQueryFromNL({
      text: '',
      userId: 'u',
      workspaceId: 'w',
    })
    expect(r.query.boundaries).toEqual([])
  })

  it('merges with activeScope boundaries (query overrides by dimension+op)', async () => {
    const r = await parseQueryFromNL({
      text: 'anything',
      userId: 'u',
      workspaceId: 'w',
      activeScope: {
        scope_id: 'x',
        name: 'x',
        mode: 'static',
        persists_until: 'session_end',
        boundaries: [{ dimension: 'confidence', op: 'gte', value: 0.8 }],
        ownerId: 'u',
        workspaceId: 'w',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    // Active scope's confidence boundary should survive in the fallback.
    expect(
      r.query.boundaries.some((b) => b.dimension === 'confidence' && b.op === 'gte')
    ).toBe(true)
  })
})

describe('nl-parser LLM path (mocked)', () => {
  const originalKey = process.env.OPENROUTER_API_KEY
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key'
  })

  afterEach(() => {
    if (originalKey) process.env.OPENROUTER_API_KEY = originalKey
    else delete process.env.OPENROUTER_API_KEY
    globalThis.fetch = originalFetch
  })

  it('parses a valid JSON response into boundaries', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                boundaries: [
                  { dimension: 'contributor', op: 'include', values: ['priya'] },
                  { dimension: 'confidence', op: 'gte', value: 0.9 },
                ],
                select: {
                  fields: ['id', 'content', 'contributor', 'confidence', 'createdAt'],
                  limit: 100,
                  orderBy: { field: 'createdAt', direction: 'desc' },
                },
              }),
            },
          },
        ],
      }),
    })) as unknown as typeof fetch

    const r = await parseQueryFromNL({
      text: 'priya high-confidence facts',
      userId: 'u',
      workspaceId: 'w',
    })
    expect(r.warnings).toEqual([])
    expect(r.query.boundaries).toHaveLength(2)
    expect(r.query.boundaries[0]!.dimension).toBe('contributor')
    expect(r.query.select.limit).toBe(100)
  })

  it('falls back with warning when response is non-JSON', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'sorry, I cannot help' } }] }),
    })) as unknown as typeof fetch

    const r = await parseQueryFromNL({
      text: 'something',
      userId: 'u',
      workspaceId: 'w',
    })
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('falls back with warning on non-200 response', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch

    const r = await parseQueryFromNL({
      text: 'x',
      userId: 'u',
      workspaceId: 'w',
    })
    expect(r.warnings.some((w) => /500/.test(w))).toBe(true)
  })
})
