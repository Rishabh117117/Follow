import { describe, it, expect } from 'vitest'
import {
  composeContentFacet,
  composeCausalFacet,
  composeContextFacet,
  type ComposeInput,
} from '../../semantic-index/compose-embedding-text'
import { WEIGHT_PROFILES_V2, detectQueryProfile } from '../../semantic-index/weighted-referencing'

function makeInput(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    event: {
      label: 'Updated budget table',
      type: 'edit',
      magnitude: 'medium',
      keyChange: true,
      contextNotes: 'After reviewing Q1 data',
      metadata: {},
    },
    threadType: 'doc',
    userName: 'Alice',
    documentTitle: 'Project Proposal',
    sectionAlias: 'Budget',
    ...overrides,
  }
}

describe('composeContentFacet', () => {
  it('carries the action label but NOT the reasoning (FACET-FIX-1)', () => {
    const result = composeContentFacet(makeInput())
    expect(result).toContain('Updated budget table')
    // contextNotes is WHY — it belongs to the causal facet, not content. Keeping
    // it here was the content↔causal overlap this sprint removes.
    expect(result).not.toContain('After reviewing Q1 data')
  })

  it('includes chat chunkContent as the substance of WHAT (FACET-FIX-1)', () => {
    const result = composeContentFacet(
      makeInput({
        threadType: 'ai',
        event: {
          label: 'Discussed pricing',
          type: 'ai_interaction',
          magnitude: 'small',
          keyChange: false,
          contextNotes: null,
          metadata: { chunkContent: 'the real conversation text about pricing' },
        },
      })
    )
    expect(result).toContain('the real conversation text about pricing')
  })

  it('handles notebook blocks', () => {
    const result = composeContentFacet(
      makeInput({
        event: {
          label: 'Drew diagram',
          type: 'edit',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: null,
          metadata: { blockType: 'freehand' },
        },
      })
    )
    expect(result).toContain('freehand block')
    expect(result).toContain('visual/sketch')
  })

  it('includes plain text for text blocks', () => {
    const result = composeContentFacet(
      makeInput({
        event: {
          label: 'Added text',
          type: 'edit',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: null,
          metadata: { blockType: 'text', plainText: 'Some important notes here' },
        },
      })
    )
    expect(result).toContain('text block')
    expect(result).toContain('Some important notes')
  })

  it('caps at 500 chars', () => {
    const longLabel = 'A'.repeat(600)
    const result = composeContentFacet(
      makeInput({
        event: {
          label: longLabel,
          type: 'edit',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: null,
          metadata: {},
        },
      })
    )
    expect(result.length).toBeLessThanOrEqual(500)
  })
})

describe('composeCausalFacet', () => {
  it('includes reasoning context', () => {
    const result = composeCausalFacet(makeInput())
    expect(result).toContain('Reason: After reviewing Q1 data')
  })

  it('marks key changes as deliberate', () => {
    const result = composeCausalFacet(makeInput())
    expect(result).toContain('deliberate, significant change')
  })

  it('includes chat question when present', () => {
    const result = composeCausalFacet(
      makeInput({
        event: {
          label: 'AI edit',
          type: 'ai_interaction',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: null,
          metadata: { chatQuestion: 'How should I structure the budget?' },
        },
      })
    )
    expect(result).toContain('After asking:')
    expect(result).toContain('structure the budget')
  })

  it('handles freehand events', () => {
    const result = composeCausalFacet(
      makeInput({
        event: {
          label: 'Sketch',
          type: 'edit',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: null,
          metadata: { blockType: 'freehand' },
        },
      })
    )
    expect(result).toContain('visual thinking')
  })

  it('returns empty string when there is no genuine WHY — NO label fallback (FACET-FIX-1)', () => {
    const result = composeCausalFacet(
      makeInput({
        event: {
          label: 'Quick edit',
          type: 'edit',
          magnitude: 'small',
          keyChange: false,
          contextNotes: null,
          metadata: {},
        },
      })
    )
    // Empty ⇒ the indexer stores NULL ⇒ no spurious contradiction geometry.
    expect(result).toBe('')
  })

  it('does NOT treat a bare topic list as causal reasoning (FACET-FIX-1)', () => {
    const result = composeCausalFacet(
      makeInput({
        event: {
          label: 'Chatted',
          type: 'ai_interaction',
          magnitude: 'small',
          keyChange: false,
          contextNotes: 'Topics: pricing, launch',
          metadata: {},
        },
      })
    )
    expect(result).toBe('')
  })

  it('content and causal carry DISTINCT text for a chat event (the whole point)', () => {
    const input = makeInput({
      threadType: 'ai',
      event: {
        label: 'Discussed pricing',
        type: 'ai_interaction',
        magnitude: 'medium',
        keyChange: false,
        contextNotes: null,
        metadata: {
          chunkContent: '[user] what price?\n\n[assistant] we set it to $9/mo after analysis',
          chatQuestion: 'what price?',
        },
      },
    })
    const content = composeContentFacet(input)
    const causal = composeCausalFacet(input)
    expect(content).toContain('we set it to $9')
    expect(causal).toContain('what price?')
    expect(content).not.toBe(causal)
  })
})

describe('composeContextFacet', () => {
  it('includes document and section', () => {
    const result = composeContextFacet(makeInput())
    expect(result).toContain('Document: Project Proposal')
    expect(result).toContain('Section: Budget')
  })

  it('includes page number for notebook events', () => {
    const result = composeContextFacet(
      makeInput({
        event: {
          label: 'Edit',
          type: 'edit',
          magnitude: 'medium',
          keyChange: false,
          contextNotes: null,
          metadata: { pageNumber: 3 },
        },
      })
    )
    expect(result).toContain('Page 3')
  })
})

describe('WEIGHT_PROFILES_V2', () => {
  it('why_query weights causal heavily', () => {
    expect(WEIGHT_PROFILES_V2.why_query!.causal).toBe(0.4)
    expect(WEIGHT_PROFILES_V2.why_query!.causal).toBeGreaterThan(
      WEIGHT_PROFILES_V2.why_query!.content
    )
  })

  it('who_query weights authorship heavily', () => {
    expect(WEIGHT_PROFILES_V2.who_query!.authorship).toBe(0.5)
    expect(WEIGHT_PROFILES_V2.who_query!.authorship).toBeGreaterThan(
      WEIGHT_PROFILES_V2.who_query!.content
    )
  })

  it('all profiles sum to ~1.0', () => {
    for (const [name, profile] of Object.entries(WEIGHT_PROFILES_V2)) {
      if (name === 'evidence') continue // evidence is all zeros
      const sum = Object.values(profile).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1.0, 1)
    }
  })
})

describe('detectQueryProfile', () => {
  it('"why" questions switch to why_query', () => {
    expect(detectQueryProfile('Why was Section 2 rewritten?', 'focused')).toBe('why_query')
    expect(detectQueryProfile('What caused the budget change?', 'focused')).toBe('why_query')
    expect(detectQueryProfile('How come the intro was deleted?', 'focused')).toBe('why_query')
  })

  it('"who" questions switch to who_query', () => {
    expect(detectQueryProfile('Who edited the conclusion?', 'focused')).toBe('who_query')
    expect(detectQueryProfile('Which user contributed to methods?', 'focused')).toBe('who_query')
  })

  it('non-qualifying questions stay as focused', () => {
    expect(detectQueryProfile('Show me recent changes', 'focused')).toBe('focused')
    expect(detectQueryProfile('What is in Section 3?', 'focused')).toBe('focused')
  })

  it('only triggers on focused profile', () => {
    expect(detectQueryProfile('Why was it changed?', 'history')).toBe('history')
    expect(detectQueryProfile('Who did it?', 'realtime')).toBe('realtime')
  })

  it('returns requested profile when no query', () => {
    expect(detectQueryProfile(undefined, 'focused')).toBe('focused')
  })
})
