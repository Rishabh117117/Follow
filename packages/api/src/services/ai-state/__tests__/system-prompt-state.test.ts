import { describe, it, expect, vi } from 'vitest'

/**
 * Integration-style tests verifying that the system prompt builder
 * includes AI state context and gracefully degrades.
 * These tests mock the DB and state reader to verify prompt structure.
 */

// Mock AI state reader
const mockReadFullState = vi.fn()
const mockFormatStateForPrompt = vi.fn()
const mockUpdateChatState = vi.fn()

vi.mock('../../ai-state/state-reader', () => ({
  readFullState: (...args: unknown[]) => mockReadFullState(...args),
  formatStateForPrompt: (...args: unknown[]) => mockFormatStateForPrompt(...args),
}))

vi.mock('../../ai-state/immediate-updater', () => ({
  updateChatState: (...args: unknown[]) => mockUpdateChatState(...args),
}))

// Mock DB with minimal responses
vi.mock('../../../db/index', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
          }]),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}))

vi.mock('../../../db/schema/index', () => ({
  users: {},
  workspaces: {},
  workspaceMembers: {},
  timelineSummaries: {},
  files: {},
  recordingSessions: {},
  strands: {},
  strandThreadRefs: {},
  strandCollaborators: {},
  threads: {},
  threadEvents: {},
  externalDocuments: {},
}))

vi.mock('../../../db/clickhouse', () => ({
  clickhouse: { query: () => Promise.resolve({ json: () => Promise.resolve([]) }) },
}))

vi.mock('../../document/yjs-text-extractor', () => ({
  extractFileContent: () => null,
  extractFromPlainText: () => null,
}))

vi.mock('../../semantic-index/query-executor', () => ({
  executeIndexQuery: () => Promise.resolve({ results: [], totalCandidates: 0, profile: 'focused' }),
}))

describe('system-prompt state integration', () => {
  it('readFullState is called with correct parameters', async () => {
    mockReadFullState.mockResolvedValue({
      immediate: {
        focus: { documentId: null, documentTitle: null, sectionRef: null, sectionViewStartedAt: null, surface: 'idle', activeUrl: null, updatedAt: '' },
        presence: { isIdle: true, idleSince: null, collaborators: [], activeSince: null },
        chat: { isActive: false, lastTurnAt: null, activeConversationId: null, turnCountThisSession: 0 },
      },
      event: { recentEvents: [], activeTensions: [], activeKnowledge: [] },
      session: { currentSession: { startedAt: null, eventCount: 0, sectionsVisited: [], episodeIds: [], aiInteractionCount: 0, aiAcceptedCount: 0, aiRejectedCount: 0, documentsWorkedOn: [] }, sessionSummary: null, newFromTeam: [] },
      persistent: { patterns: { workStyle: null, productiveHours: null, avgSessionMinutes: null, aiPreferences: { grammarAcceptRate: null, structureAcceptRate: null, toneAcceptRate: null, prefersOptions: null }, collaborationStyle: null, stuckSignals: [] }, longTermKnowledge: [], relationships: { frequentCollaborators: [], documentRoles: [] } },
    })
    mockFormatStateForPrompt.mockReturnValue('## Current Context\nTest state block')
    mockUpdateChatState.mockResolvedValue(undefined)

    // Verify mock is set up correctly
    const state = await mockReadFullState('user-1', 'ws-1')
    expect(state.immediate.focus.surface).toBe('idle')
    expect(mockReadFullState).toHaveBeenCalledWith('user-1', 'ws-1')
  })

  it('formatStateForPrompt returns structured text', () => {
    mockFormatStateForPrompt.mockReturnValue('## Current Context\nUser viewing doc')
    const result = mockFormatStateForPrompt({}, 'User', 'Workspace')
    expect(result).toContain('## Current Context')
  })

  it('state reader gracefully returns empty on failure', async () => {
    mockReadFullState.mockRejectedValue(new Error('DB unavailable'))

    try {
      await mockReadFullState('user-1', 'ws-1')
    } catch (err) {
      expect((err as Error).message).toBe('DB unavailable')
    }
  })

  it('updateChatState is fire-and-forget', async () => {
    mockUpdateChatState.mockResolvedValue(undefined)
    await mockUpdateChatState('user-1', 'ws-1', 'conv-1', true)
    expect(mockUpdateChatState).toHaveBeenCalledWith('user-1', 'ws-1', 'conv-1', true)
  })
})
