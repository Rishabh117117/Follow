import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReflectionInput, ReflectionOutput } from '../reflector'

// Mock Redis
let redisStore: Record<string, { value: string; ttl: number }> = {}
vi.mock('../../../redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => redisStore[key]?.value ?? null),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      redisStore[key] = { value, ttl }
      return 'OK'
    }),
  },
}))

// Mock DB
vi.mock('../../../db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
  },
}))

vi.mock('../../../db/schema/ai-state', () => ({
  aiState: { userId: 'user_id', workspaceId: 'workspace_id', version: 'version' },
  documentSharedState: {},
}))

// Mock AI client
const mockCreate = vi.fn()
vi.mock('../../../lib/ai-client', () => ({
  getOpenRouterClient: () => ({
    chat: { completions: { create: mockCreate } },
  }),
}))

vi.mock('../../../config/models', () => ({
  MODEL_TIERS: { INDEX_AGENT: 'google/gemini-2.5-flash' },
}))

import { reflectOnEvent } from '../reflector'

beforeEach(() => {
  redisStore = {}
  mockCreate.mockReset()
})

function makeInput(overrides: Partial<ReflectionInput['event']> = {}): ReflectionInput {
  return {
    event: {
      eventId: 'ev-1',
      label: 'Updated budget table',
      type: 'edit',
      section: 'Budget',
      threadType: 'doc',
      timestamp: new Date().toISOString(),
      isKeyChange: true,
      isAIInvolved: false,
      contextNotes: null,
      magnitude: 'medium',
      ...overrides,
    },
    userId: 'user-1',
    workspaceId: 'ws-1',
    documentId: 'doc-1',
    documentTitle: 'Project Proposal',
  }
}

describe('reflectOnEvent', () => {
  it('returns null for tiny magnitude events', async () => {
    const result = await reflectOnEvent(makeInput({ magnitude: 'tiny' }))
    expect(result).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('produces valid ReflectionOutput structure', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              tension: { description: 'Budget conflicts with Q1', severity: 'medium', sections: ['Budget'] },
              connection: null,
              shift: null,
              gap: null,
              knowledge: { fact: 'Budget is $50k', source: 'doc edit', confidence: 0.7 },
              confidence: 0.6,
            }),
          },
        },
      ],
    })

    const result = await reflectOnEvent(makeInput())
    expect(result).not.toBeNull()
    expect(result!.tension).not.toBeNull()
    expect(result!.tension!.severity).toBe('medium')
    expect(result!.knowledge).not.toBeNull()
    expect(result!.overallConfidence).toBe(0.6)
  })

  it('caps gap confidence at 0.8', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              tension: null,
              connection: null,
              shift: null,
              gap: { description: 'Missing source citation', confidence: 0.95 },
              knowledge: null,
              confidence: 0.9,
            }),
          },
        },
      ],
    })

    const result = await reflectOnEvent(makeInput())
    expect(result!.gap!.confidence).toBe(0.8)
  })

  it('caps knowledge confidence at 0.8', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              tension: null,
              connection: null,
              shift: null,
              gap: null,
              knowledge: { fact: 'Deadline is March 15', source: 'email', confidence: 0.99 },
              confidence: 0.8,
            }),
          },
        },
      ],
    })

    const result = await reflectOnEvent(makeInput())
    expect(result!.knowledge!.confidence).toBe(0.8)
  })

  it('handles LLM failure gracefully (returns null)', async () => {
    mockCreate.mockRejectedValue(new Error('API timeout'))

    const result = await reflectOnEvent(makeInput())
    expect(result).toBeNull()
  })

  it('handles empty LLM response', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: null } }] })

    const result = await reflectOnEvent(makeInput())
    expect(result).toBeNull()
  })

  it('processes medium magnitude events', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              tension: null,
              connection: null,
              shift: { description: 'Shifted from research to writing', from: 'research', to: 'writing' },
              gap: null,
              knowledge: null,
              confidence: 0.5,
            }),
          },
        },
      ],
    })

    const result = await reflectOnEvent(makeInput({ magnitude: 'medium' }))
    expect(result).not.toBeNull()
    expect(result!.shift).not.toBeNull()
  })

  it('returns null fields as null when LLM returns them', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              tension: null,
              connection: null,
              shift: null,
              gap: null,
              knowledge: null,
              confidence: 0.3,
            }),
          },
        },
      ],
    })

    const result = await reflectOnEvent(makeInput())
    expect(result!.tension).toBeNull()
    expect(result!.connection).toBeNull()
    expect(result!.shift).toBeNull()
    expect(result!.gap).toBeNull()
    expect(result!.knowledge).toBeNull()
  })
})
