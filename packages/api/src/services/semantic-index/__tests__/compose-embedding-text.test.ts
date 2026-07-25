import { describe, it, expect } from 'vitest'
import { composeEmbeddingText, mapMagnitude } from '../compose-embedding-text'
import type { ComposeInput } from '../compose-embedding-text'

describe('composeEmbeddingText', () => {
  // ─── mapMagnitude ─────────────────────────────────────────────────

  describe('mapMagnitude', () => {
    it('maps low to small', () => {
      expect(mapMagnitude('low')).toBe('small')
    })

    it('maps medium to medium', () => {
      expect(mapMagnitude('medium')).toBe('medium')
    })

    it('maps high to large', () => {
      expect(mapMagnitude('high')).toBe('large')
    })

    it('defaults unknown values to small', () => {
      expect(mapMagnitude('unknown')).toBe('small')
      expect(mapMagnitude('')).toBe('small')
    })
  })

  // ─── Doc template ─────────────────────────────────────────────────

  describe('doc template', () => {
    it('produces structured text for doc edits', () => {
      const input: ComposeInput = {
        event: {
          label: 'Rewrote introduction paragraph',
          type: 'edit',
          magnitude: 'high',
          keyChange: true,
          contextNotes: 'Major rewrite of opening',
          metadata: { wordDelta: 150 },
        },
        threadType: 'doc',
        userName: 'Alice',
        documentTitle: 'Research Paper',
        sectionAlias: 'Introduction',
      }

      const text = composeEmbeddingText(input)
      expect(text).toContain('[DOC]')
      expect(text).toContain('Alice')
      expect(text).toContain('Introduction')
      expect(text).toContain('Research Paper')
      expect(text).toContain('key change')
      expect(text).toContain('+150')
    })

    it('omits section when null', () => {
      const input: ComposeInput = {
        event: {
          label: 'Made edits',
          type: 'edit',
          magnitude: 'low',
          keyChange: false,
          contextNotes: null,
          metadata: {},
        },
        threadType: 'doc',
        userName: 'Bob',
        documentTitle: 'Doc',
        sectionAlias: null,
      }

      const text = composeEmbeddingText(input)
      expect(text).toContain('[DOC]')
      expect(text).not.toContain('Context:')
    })

    // DOC-FACTS-B0: doc-fact embeddings must carry the actual document content
    // (parity with the AI template) so retrieval works on document substance.
    it('embeds chunk content when a doc-fact extractor populated it', () => {
      const input: ComposeInput = {
        event: {
          label: 'Hydration controls crumb structure',
          type: 'edit',
          magnitude: 'high',
          keyChange: true,
          contextNotes: null,
          metadata: { chunkContent: 'Higher hydration yields a more open crumb.' },
        },
        threadType: 'doc',
        userName: 'Alice',
        documentTitle: 'Baking Notes',
        sectionAlias: 'Crumb',
      }

      const text = composeEmbeddingText(input)
      expect(text).toContain('Content: Higher hydration yields a more open crumb.')
    })

    it('omits the Content line when no chunk content is present (doc-edit signal)', () => {
      const input: ComposeInput = {
        event: {
          label: 'Edited a section',
          type: 'edit',
          magnitude: 'low',
          keyChange: false,
          contextNotes: null,
          metadata: { wordDelta: 12 },
        },
        threadType: 'doc',
        userName: 'Bob',
        documentTitle: 'Doc',
        sectionAlias: null,
      }

      const text = composeEmbeddingText(input)
      expect(text).not.toContain('Content:')
    })
  })

  // ─── AI template ──────────────────────────────────────────────────

  describe('ai template', () => {
    it('produces structured text for AI interactions', () => {
      const input: ComposeInput = {
        event: {
          label: 'Asked AI to improve clarity',
          type: 'ai_interaction',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: 'AI suggested rewording',
          metadata: { outcome: 'accepted', questionSummary: 'Improve clarity' },
        },
        threadType: 'ai',
        userName: 'Carol',
        documentTitle: 'Proposal',
        sectionAlias: 'Summary',
      }

      const text = composeEmbeddingText(input)
      expect(text).toContain('[AI]')
      expect(text).toContain('Carol')
      expect(text).toContain('accepted')
      expect(text).toContain('Improve clarity')
    })
  })

  // ─── Browser template ─────────────────────────────────────────────

  describe('browser template', () => {
    it('produces structured text for navigation events', () => {
      const input: ComposeInput = {
        event: {
          label: 'Visited competitor analysis page',
          type: 'navigation',
          magnitude: 'low',
          keyChange: false,
          contextNotes: null,
          metadata: { pageTitle: 'Competitor Report', domain: 'example.com', timeOnPage: 45 },
        },
        threadType: 'browser',
        userName: 'Dave',
        documentTitle: 'Strategy Doc',
        sectionAlias: 'Market Analysis',
      }

      const text = composeEmbeddingText(input)
      expect(text).toContain('[BROWSE]')
      expect(text).toContain('Competitor Report')
      expect(text).toContain('example.com')
      expect(text).toContain('45s')
    })
  })

  // ─── User template ────────────────────────────────────────────────

  describe('user template', () => {
    it('produces structured text for user activity', () => {
      const input: ComposeInput = {
        event: {
          label: 'Focused on writing for 30 minutes',
          type: 'edit',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: 'Deep work session',
          metadata: {},
        },
        threadType: 'user',
        userName: 'Eve',
        documentTitle: 'Essay',
        sectionAlias: 'Conclusion',
      }

      const text = composeEmbeddingText(input)
      expect(text).toContain('[ACTIVITY]')
      expect(text).toContain('Eve')
      expect(text).toContain('Conclusion')
    })
  })

  // ─── Import template ──────────────────────────────────────────────

  describe('import template', () => {
    it('produces structured text for imports', () => {
      const input: ComposeInput = {
        event: {
          label: 'Imported ChatGPT conversation',
          type: 'import',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: null,
          metadata: { sourcePlatform: 'ChatGPT', conversationTopic: 'API design' },
        },
        threadType: 'import',
        userName: 'Frank',
        documentTitle: 'Tech Spec',
        sectionAlias: null,
      }

      const text = composeEmbeddingText(input)
      expect(text).toContain('[IMPORT]')
      expect(text).toContain('ChatGPT')
      expect(text).toContain('API design')
    })
  })

  // ─── Edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles all null optional fields', () => {
      const input: ComposeInput = {
        event: {
          label: 'Something happened',
          type: 'edit',
          magnitude: 'low',
          keyChange: false,
          contextNotes: null,
          metadata: {},
        },
        threadType: 'doc',
        userName: null,
        documentTitle: null,
        sectionAlias: null,
      }

      const text = composeEmbeddingText(input)
      expect(text).toBeTruthy()
      expect(text).toContain('[DOC]')
      expect(text).toContain('Unknown user')
    })

    it('truncates to 8000 characters', () => {
      const input: ComposeInput = {
        event: {
          label: 'A'.repeat(10000),
          type: 'edit',
          magnitude: 'high',
          keyChange: true,
          contextNotes: 'B'.repeat(5000),
          metadata: {},
        },
        threadType: 'doc',
        userName: 'Tester',
        documentTitle: 'Test Doc',
        sectionAlias: null,
      }

      const text = composeEmbeddingText(input)
      expect(text.length).toBeLessThanOrEqual(8000)
    })

    it('falls back to user template for unknown thread types', () => {
      const input: ComposeInput = {
        event: {
          label: 'Did something',
          type: 'edit',
          magnitude: 'low',
          keyChange: false,
          contextNotes: null,
          metadata: {},
        },
        threadType: 'unknown_type',
        userName: 'Test',
        documentTitle: null,
        sectionAlias: null,
      }

      const text = composeEmbeddingText(input)
      expect(text).toContain('[ACTIVITY]')
    })
  })
})
