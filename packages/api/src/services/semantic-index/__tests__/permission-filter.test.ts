import { describe, it, expect } from 'vitest'
import {
  applyPermissions,
  getPermissionLevel,
  type PermissionContext,
} from '../permission-filter'
import type { ScoredResult, CandidateRecord } from '../weighted-referencing'

function makeScoredResult(overrides: Partial<CandidateRecord> = {}): ScoredResult {
  return {
    recordId: overrides.id ?? 'rec-1',
    score: 0.8,
    signals: { semantic: 0.5, recency: 0.5, magnitude: 0.5, engagement: 0.5, structural: 0.5, authorship: 0.5 },
    record: {
      id: 'rec-1',
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      threadType: 'doc',
      indexMagnitude: 'medium',
      isKeyChange: false,
      isAIInvolved: false,
      hasEvidence: false,
      engagementDepth: 0.5,
      episodeId: null,
      documentId: null,
      documentTitle: null,
      sectionAlias: null,
      userId: 'user-2',
      userName: 'Other',
      eventTime: new Date(),
      embeddingText: 'test',
      embedding: null,
      metadata: { url: 'https://example.com', questionSummary: 'How to fix?' },
      ...overrides,
    },
  }
}

describe('PermissionFilter', () => {
  describe('getPermissionLevel', () => {
    it('returns full for own events regardless of thread type', () => {
      const result = makeScoredResult({ userId: 'user-1', threadType: 'user' })
      expect(getPermissionLevel(result, { requestingUserId: 'user-1' })).toBe('full')
    })

    it('returns full for doc threads by default', () => {
      const result = makeScoredResult({ threadType: 'doc' })
      expect(getPermissionLevel(result, { requestingUserId: 'user-1' })).toBe('full')
    })

    it('returns fact_only for AI threads by default', () => {
      const result = makeScoredResult({ threadType: 'ai' })
      expect(getPermissionLevel(result, { requestingUserId: 'user-1' })).toBe('fact_only')
    })

    it('returns fact_only for browser threads by default', () => {
      const result = makeScoredResult({ threadType: 'browser' })
      expect(getPermissionLevel(result, { requestingUserId: 'user-1' })).toBe('fact_only')
    })

    it('returns hidden for user threads by default', () => {
      const result = makeScoredResult({ threadType: 'user' })
      expect(getPermissionLevel(result, { requestingUserId: 'user-1' })).toBe('hidden')
    })

    it('returns full for AI thread when canSeeAiThread is true', () => {
      const result = makeScoredResult({ threadType: 'ai' })
      const perms: PermissionContext = {
        requestingUserId: 'user-1',
        strandVisibility: {
          canSeeUserThread: false,
          canSeeAiThread: true,
          canSeeDocThreads: true,
          canSeeBrowserThread: false,
        },
      }
      expect(getPermissionLevel(result, perms)).toBe('full')
    })

    it('returns hidden for doc thread when canSeeDocThreads is false', () => {
      const result = makeScoredResult({ threadType: 'doc' })
      const perms: PermissionContext = {
        requestingUserId: 'user-1',
        strandVisibility: {
          canSeeUserThread: false,
          canSeeAiThread: false,
          canSeeDocThreads: false,
          canSeeBrowserThread: false,
        },
      }
      expect(getPermissionLevel(result, perms)).toBe('hidden')
    })

    it('returns full for import thread regardless of visibility', () => {
      const result = makeScoredResult({ threadType: 'import' })
      expect(getPermissionLevel(result, { requestingUserId: 'user-1' })).toBe('full')
    })
  })

  describe('applyPermissions', () => {
    it('removes hidden results', () => {
      const results = [
        makeScoredResult({ id: 'r1', threadType: 'doc' }),
        makeScoredResult({ id: 'r2', threadType: 'user' }),
        makeScoredResult({ id: 'r3', threadType: 'doc' }),
      ]
      const permitted = applyPermissions(results, { requestingUserId: 'user-1' })
      expect(permitted).toHaveLength(2)
      expect(permitted.map((p) => p.recordId)).not.toContain('r2')
    })

    it('redacts metadata for fact_only results', () => {
      const results = [
        makeScoredResult({ id: 'r1', threadType: 'ai' }),
      ]
      const permitted = applyPermissions(results, { requestingUserId: 'user-1' })
      expect(permitted).toHaveLength(1)
      expect(permitted[0]!.permissionLevel).toBe('fact_only')
      // Sensitive fields should be removed
      expect(permitted[0]!.record.metadata).not.toHaveProperty('url')
      expect(permitted[0]!.record.metadata).not.toHaveProperty('questionSummary')
    })

    it('preserves all metadata for full permission results', () => {
      const results = [
        makeScoredResult({ id: 'r1', threadType: 'doc' }),
      ]
      const permitted = applyPermissions(results, { requestingUserId: 'user-1' })
      expect(permitted).toHaveLength(1)
      expect(permitted[0]!.permissionLevel).toBe('full')
      expect(permitted[0]!.record.metadata).toHaveProperty('url')
    })

    it('owner sees everything as full', () => {
      const results = [
        makeScoredResult({ id: 'r1', threadType: 'user', userId: 'me' }),
        makeScoredResult({ id: 'r2', threadType: 'ai', userId: 'me' }),
        makeScoredResult({ id: 'r3', threadType: 'browser', userId: 'me' }),
      ]
      const permitted = applyPermissions(results, { requestingUserId: 'me' })
      expect(permitted).toHaveLength(3)
      expect(permitted.every((p) => p.permissionLevel === 'full')).toBe(true)
    })
  })
})
