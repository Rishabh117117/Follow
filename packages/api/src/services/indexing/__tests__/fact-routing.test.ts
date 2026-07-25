import { describe, it, expect } from 'vitest'
import { routeFactExtraction } from '../fact-routing'

// DOC-FACTS-B0 Phase 3 — the guard at the end of handleFullIndex routes a
// fully-indexed raw_file to the right fact extractor by source_type. This is the
// pure decision the guard consumes (indexing-agent.ts).

describe('DOC-FACTS-B0 · routeFactExtraction', () => {
  it('routes chat_artifact to the chat extractor (unchanged)', () => {
    expect(routeFactExtraction('chat_artifact')).toBe('chat')
  })

  it('routes native uploaded documents (upload, local) to the doc extractor', () => {
    expect(routeFactExtraction('upload')).toBe('doc')
    expect(routeFactExtraction('local')).toBe('doc')
  })

  it('does NOT route Drive (gws) — that is a later sprint', () => {
    expect(routeFactExtraction('gws')).toBeNull()
  })

  it('routes unknown / missing source types to no facts', () => {
    expect(routeFactExtraction('something-else')).toBeNull()
    expect(routeFactExtraction(null)).toBeNull()
    expect(routeFactExtraction(undefined)).toBeNull()
  })
})
