import { describe, it, expect, vi } from 'vitest'

/**
 * Query Executor — unit tests (Sprint IX-2)
 */

const { mockDbSelect } = vi.hoisted(() => {
  function _makeSelectChain(value: unknown[] = []) {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(value)),
      groupBy: vi.fn(() => chain),
      then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject),
    }
    return chain
  }

  return {
    mockDbSelect: vi.fn(() => _makeSelectChain([])),
  }
})

vi.mock('../../../db/index', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('../../../db/schema/semantic-index', () => ({
  indexRecords: {
    workspaceId: 'workspaceId', threadEventId: 'threadEventId', threadType: 'threadType',
    eventTime: 'eventTime', episodeId: 'episodeId', documentId: 'documentId',
    isAIInvolved: 'isAIInvolved', indexMagnitude: 'indexMagnitude',
  },
  evidenceRecords: { indexRecordId: 'indexRecordId' },
  episodes: { id: 'id' },
}))

vi.mock('../../../db/schema/threads', () => ({
  strandCollaborators: { strandId: 'strandId', userId: 'userId' },
}))

vi.mock('../../embedding', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
  hasEmbeddingSupport: vi.fn().mockReturnValue(true),
}))

vi.mock('./weighted-referencing', async () => {
  const actual = await vi.importActual('./weighted-referencing')
  return {
    ...actual,
    scoreResults: vi.fn().mockReturnValue([]),
  }
})

vi.mock('./permission-filter', async () => {
  const actual = await vi.importActual('./permission-filter')
  return {
    ...actual,
    applyPermissions: vi.fn().mockReturnValue([]),
  }
})

vi.mock('./interpretation-generator', () => ({
  generateInterpretation: vi.fn().mockResolvedValue({
    narrativePhase: 'exploration',
    narrativeConfidence: 0.7,
    narrativeSummary: 'Test summary',
    workingIntent: 'Test intent',
    intentEvidence: 'Test evidence',
    cognitiveState: 'exploring',
    activeTensions: [],
    sourceInfluence: [],
    unresolvedQuestions: [],
  }),
}))

import { executeIndexQuery } from '../query-executor'

describe('executeIndexQuery', () => {
  it('returns results structure with defaults', async () => {
    const result = await executeIndexQuery({
      workspaceId: 'ws-1',
      userId: 'user-1',
    })

    expect(result).toHaveProperty('results')
    expect(result).toHaveProperty('totalCandidates')
    expect(result).toHaveProperty('profile', 'history')
    expect(Array.isArray(result.results)).toBe(true)
  })

  it('defaults to history weight profile', async () => {
    const result = await executeIndexQuery({
      workspaceId: 'ws-1',
      userId: 'user-1',
    })

    expect(result.profile).toBe('history')
  })

  it('accepts custom weight profile', async () => {
    const result = await executeIndexQuery({
      workspaceId: 'ws-1',
      userId: 'user-1',
      weightProfile: 'focused',
    })

    expect(result.profile).toBe('focused')
  })

  it('does not include interpretation when includeSummary is false', async () => {
    const result = await executeIndexQuery({
      workspaceId: 'ws-1',
      userId: 'user-1',
      includeSummary: false,
    })

    // interpretation key should not be present when includeSummary is false
    expect(result).not.toHaveProperty('interpretation')
  })

  it('returns empty results for empty workspace', async () => {
    const result = await executeIndexQuery({
      workspaceId: 'ws-1',
      userId: 'user-1',
      limit: 10,
    })

    expect(result.results).toHaveLength(0)
    expect(result.totalCandidates).toBe(0)
  })

  it('handles all optional parameters without error', async () => {
    const result = await executeIndexQuery({
      workspaceId: 'ws-1',
      userId: 'user-1',
      query: 'test query',
      weightProfile: 'ai_usage',
      documentId: 'doc-1',
      targetSection: 'Introduction',
      threadTypes: ['doc', 'ai'],
      strandId: 'strand-1',
      timeRangeMinutes: 60,
      magnitudeMin: 'medium',
      aiOnly: true,
      includeEvidence: true,
      includeEpisodes: true,
      includeSummary: false,
      limit: 25,
    })

    expect(result).toHaveProperty('results')
  })
})
