import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the embedding service. Each test overrides this implementation.
const mockGenerateEmbeddings = vi.fn()
vi.mock('../../embedding', () => ({
  generateEmbeddings: (...args: unknown[]) => mockGenerateEmbeddings(...args),
}))

// Capture inserts so the test can assert what landed in document_chunks.
const insertedRows: Array<Record<string, unknown>> = []
const mockSelectExisting = vi.fn<() => Array<{ id: string }>>(() => [])

vi.mock('../../../db/index', () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertedRows.push(row)
        return Promise.resolve()
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelectExisting(),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  },
}))

vi.mock('../../../db/schema/knowledge', () => ({
  documentChunks: {
    id: 'id',
    sourceType: 'source_type',
    sourceId: 'source_id',
    content: 'content',
    embedding: 'embedding',
    workspaceId: 'workspace_id',
  },
}))

import { indexThreadEvents } from '../thread-event-indexer'

describe('indexThreadEvents (MCP-FIX-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedRows.length = 0
    mockSelectExisting.mockImplementation(() => [])
  })

  it('stores chunks with embeddings when embedding service succeeds', async () => {
    mockGenerateEmbeddings.mockResolvedValueOnce([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ])

    await indexThreadEvents([
      {
        id: 'evt-1',
        threadId: 'thread-1',
        workspaceId: 'ws-1',
        label: 'What is Follow?',
        type: 'user_prompt',
        magnitude: 'medium',
      },
      {
        id: 'evt-2',
        threadId: 'thread-1',
        workspaceId: 'ws-1',
        label: 'Follow is a context sharing system.',
        type: 'ai_response',
        magnitude: 'medium',
      },
    ])

    expect(insertedRows).toHaveLength(2)
    expect(insertedRows[0]!.embedding).toEqual([0.1, 0.2, 0.3])
    expect(insertedRows[1]!.embedding).toEqual([0.4, 0.5, 0.6])
    expect(insertedRows[0]!.sourceType).toBe('thread_event')
  })

  // The fix: previously a thrown embedding error returned early and stored
  // ZERO chunks, which is why save_conversation never appeared in
  // query_index. After MCP-FIX-2 we must still store chunks (just without
  // embeddings) so the LIKE-based fallback path can find them.
  it('stores chunks WITHOUT embeddings when embedding service fails', async () => {
    mockGenerateEmbeddings.mockRejectedValueOnce(new Error('OPENAI_API_KEY missing'))

    await indexThreadEvents([
      {
        id: 'evt-fail-1',
        threadId: 'thread-2',
        workspaceId: 'ws-1',
        label: 'Some user message',
        type: 'user_prompt',
        magnitude: 'medium',
      },
    ])

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]!.embedding).toBeNull()
    expect(insertedRows[0]!.content).toBe('Some user message')
    expect(insertedRows[0]!.sourceType).toBe('thread_event')
  })

  it('skips events whose chunks already exist (deduplication)', async () => {
    mockGenerateEmbeddings.mockResolvedValueOnce([[0.1]])
    mockSelectExisting.mockImplementation(() => [{ id: 'existing-chunk' }])

    await indexThreadEvents([
      {
        id: 'evt-dup',
        threadId: 'thread-3',
        workspaceId: 'ws-1',
        label: 'duplicate event',
        type: 'user_prompt',
        magnitude: 'small',
      },
    ])

    expect(insertedRows).toHaveLength(0)
  })

  it('returns early on empty event list without calling embedding service', async () => {
    await indexThreadEvents([])
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
    expect(insertedRows).toHaveLength(0)
  })
})
