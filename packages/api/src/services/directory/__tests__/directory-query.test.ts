import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Directory Query Service — unit tests (Sprint CTX-2)
 */

const { mockRecords, mockUsers, mockStates, mockConvos } = vi.hoisted(() => ({
  mockRecords: vi.fn(),
  mockUsers: vi.fn(),
  mockStates: vi.fn(),
  mockConvos: vi.fn(),
}))

vi.mock('../../../db/index', () => {
  let callCount = 0
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: any) => {
          // Use table name symbol to disambiguate
          return {
            where: vi.fn(() => {
              const result = (() => {
                const tname = String(table?.[Symbol.for('drizzle:Name')] ?? '')
                if (tname.includes('index_record_states')) return mockStates()
                if (tname.includes('chat_conversations')) return mockConvos()
                if (tname.includes('users')) return mockUsers()
                if (tname.includes('index_records')) return mockRecords()
                // Fallback by call order for vitest'd mocks without schema names
                callCount++
                if (callCount === 1) return mockRecords()
                if (callCount === 2) return mockUsers()
                if (callCount === 3) return mockStates()
                return mockConvos()
              })()
              return {
                limit: vi.fn(() => Promise.resolve(result)),
                then: (resolve: any, reject: any) =>
                  Promise.resolve(result).then(resolve, reject),
              }
            }),
          }
        }),
      })),
    },
  }
})

vi.mock('../../../db/schema/semantic-index', () => ({
  indexRecords: {
    id: 'id',
    hidden: 'hidden',
    userId: 'userId',
    userName: 'userName',
    threadType: 'threadType',
    sourceFileId: 'sourceFileId',
    embeddingText: 'embeddingText',
    engagementDepth: 'engagementDepth',
    eventTime: 'eventTime',
    indexedAt: 'indexedAt',
    metadata: 'metadata',
    [Symbol.for('drizzle:Name')]: 'index_records',
  },
  indexRecordStates: {
    indexRecordId: 'indexRecordId',
    supersededBy: 'supersededBy',
    [Symbol.for('drizzle:Name')]: 'index_record_states',
  },
}))

vi.mock('../../../db/schema/chat', () => ({
  chatConversations: {
    userId: 'userId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    [Symbol.for('drizzle:Name')]: 'chat_conversations',
  },
}))

vi.mock('../../../db/schema/users', () => ({
  users: {
    id: 'id',
    name: 'name',
    email: 'email',
    [Symbol.for('drizzle:Name')]: 'users',
  },
}))

import { queryDirectory } from '../directory-query'

beforeEach(() => {
  mockRecords.mockReturnValue([])
  mockUsers.mockReturnValue([])
  mockStates.mockReturnValue([])
  mockConvos.mockReturnValue([])
})

describe('queryDirectory (Sprint CTX-2)', () => {
  it('returns contributors grouped by userId for topic match', async () => {
    mockRecords.mockReturnValue([
      {
        id: 'r1',
        userId: 'user-a',
        userName: 'Alice',
        threadType: 'doc',
        sourceFileId: 'f1',
        embeddingText: 'encryption is important',
        engagementDepth: 0.9,
        eventTime: new Date('2026-04-10'),
        indexedAt: new Date(),
        metadata: { source: 'local' },
      },
      {
        id: 'r2',
        userId: 'user-a',
        userName: 'Alice',
        threadType: 'ai',
        sourceFileId: null,
        embeddingText: 'encryption keys rotate monthly',
        engagementDepth: 0.85,
        eventTime: new Date('2026-04-11'),
        indexedAt: new Date(),
        metadata: {},
      },
      {
        id: 'r3',
        userId: 'user-b',
        userName: 'Bob',
        threadType: 'doc',
        sourceFileId: null,
        embeddingText: 'encryption at rest for databases',
        engagementDepth: 0.7,
        eventTime: new Date('2026-04-09'),
        indexedAt: new Date(),
        metadata: {},
      },
    ])
    mockUsers.mockReturnValue([
      { id: 'user-a', name: 'Alice', email: 'alice@x.io' },
      { id: 'user-b', name: 'Bob', email: 'bob@x.io' },
    ])
    const res = await queryDirectory({
      topic: 'encryption',
      indexId: 'personal',
      userId: 'user-a',
    })
    expect(res.totalContributors).toBe(2)
    expect(res.contributors.map((c) => c.userId).sort()).toEqual(['user-a', 'user-b'])
  })

  it('computes avgEngagement correctly across contributor facts', async () => {
    mockRecords.mockReturnValue([
      {
        id: 'r1', userId: 'u1', userName: 'U', threadType: 'doc',
        sourceFileId: null, embeddingText: 't', engagementDepth: 0.9,
        eventTime: new Date(), indexedAt: new Date(), metadata: {},
      },
      {
        id: 'r2', userId: 'u1', userName: 'U', threadType: 'doc',
        sourceFileId: null, embeddingText: 't', engagementDepth: 0.5,
        eventTime: new Date(), indexedAt: new Date(), metadata: {},
      },
    ])
    mockUsers.mockReturnValue([{ id: 'u1', name: 'U', email: 'u@x' }])
    const res = await queryDirectory({ topic: 't', indexId: 'personal', userId: 'u1' })
    expect(res.contributors[0]?.avgEngagement).toBeCloseTo(0.7, 2)
  })

  it('includes contradictions when metadata links records across users', async () => {
    mockRecords.mockReturnValue([
      {
        id: 'r1', userId: 'u1', userName: 'Alice', threadType: 'doc',
        sourceFileId: null, embeddingText: 'Uses AES-256', engagementDepth: 0.9,
        eventTime: new Date(), indexedAt: new Date(),
        metadata: { contradictsIds: ['r2'] },
      },
      {
        id: 'r2', userId: 'u2', userName: 'Bob', threadType: 'doc',
        sourceFileId: null, embeddingText: 'Uses RSA', engagementDepth: 0.8,
        eventTime: new Date(), indexedAt: new Date(), metadata: {},
      },
    ])
    mockUsers.mockReturnValue([
      { id: 'u1', name: 'Alice', email: 'a@x' },
      { id: 'u2', name: 'Bob', email: 'b@x' },
    ])
    const res = await queryDirectory({
      topic: 'encryption',
      indexId: 'personal',
      userId: 'u1',
    })
    expect(res.contradictions.length).toBeGreaterThan(0)
    expect(res.routingReason).toBe('contested')
  })

  it('sets routingReason to "multi-contributor" when 2+ contributors and no contradictions', async () => {
    mockRecords.mockReturnValue([
      { id: 'r1', userId: 'u1', userName: 'A', threadType: 'doc', sourceFileId: null, embeddingText: 't', engagementDepth: 0.9, eventTime: new Date(), indexedAt: new Date(), metadata: {} },
      { id: 'r2', userId: 'u2', userName: 'B', threadType: 'doc', sourceFileId: null, embeddingText: 't', engagementDepth: 0.8, eventTime: new Date(), indexedAt: new Date(), metadata: {} },
    ])
    mockUsers.mockReturnValue([
      { id: 'u1', name: 'Alice', email: 'a' },
      { id: 'u2', name: 'Bob', email: 'b' },
    ])
    const res = await queryDirectory({ topic: 't', indexId: 'personal', userId: 'u1' })
    expect(res.routingReason).toBe('multi-contributor')
  })

  it('sets routingReason to "deep-analysis" when single contributor has many facts', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`, userId: 'u1', userName: 'Solo', threadType: 'doc',
      sourceFileId: null, embeddingText: 'topic deep analysis',
      engagementDepth: 0.9, eventTime: new Date(), indexedAt: new Date(), metadata: {},
    }))
    mockRecords.mockReturnValue(rows)
    mockUsers.mockReturnValue([{ id: 'u1', name: 'Solo', email: 's@x' }])
    const res = await queryDirectory({ topic: 'analysis', indexId: 'personal', userId: 'u1' })
    expect(res.routingReason).toBe('deep-analysis')
  })

  it('generates a human-readable recommendation', async () => {
    mockRecords.mockReturnValue([
      { id: 'r1', userId: 'u1', userName: 'Alice', threadType: 'doc', sourceFileId: null, embeddingText: 't', engagementDepth: 0.9, eventTime: new Date(), indexedAt: new Date(), metadata: {} },
      { id: 'r2', userId: 'u2', userName: 'Bob', threadType: 'doc', sourceFileId: null, embeddingText: 't', engagementDepth: 0.8, eventTime: new Date(), indexedAt: new Date(), metadata: {} },
    ])
    mockUsers.mockReturnValue([
      { id: 'u1', name: 'Alice', email: 'a' },
      { id: 'u2', name: 'Bob', email: 'b' },
    ])
    const res = await queryDirectory({ topic: 't', indexId: 'personal', userId: 'u1' })
    expect(res.recommendation).toMatch(/deepest coverage|contradiction|analysis|Alice|Bob/)
    expect(res.recommendation.length).toBeGreaterThan(20)
  })
})
