import { describe, it, expect } from 'vitest'
import { extractQuestionFromChunk } from '../chat-fact-extractor'

// FACET-FIX-1: the causal facet's real WHY-signal on the chat path comes from
// recovering the user turn out of a transcript chunk. The transcript is
// serialized as "[user] …\n\n[assistant] …" (save-conversation).

describe('FACET-FIX-1 · extractQuestionFromChunk', () => {
  it('pulls the user turn before the assistant reply', () => {
    const chunk = '[user] How should we price the plan?\n\n[assistant] Consider $9/mo.'
    expect(extractQuestionFromChunk(chunk)).toBe('How should we price the plan?')
  })

  it('returns null when the chunk has no user turn', () => {
    expect(extractQuestionFromChunk('[assistant] Here is the analysis only.')).toBeNull()
    expect(extractQuestionFromChunk('flat text with no role markers')).toBeNull()
  })

  it('collapses whitespace and caps length', () => {
    const long = '[user] ' + 'word '.repeat(200) + '\n\n[assistant] ok'
    const q = extractQuestionFromChunk(long)
    expect(q).not.toBeNull()
    expect(q!.length).toBeLessThanOrEqual(300)
    expect(q!).not.toMatch(/\s{2,}/)
  })

  it('captures the first user turn when multiple are present', () => {
    const chunk = '[user] first question\n\n[assistant] a1\n\n[user] second question'
    expect(extractQuestionFromChunk(chunk)).toBe('first question')
  })
})
