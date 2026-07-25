/**
 * NO-LEAK invariant tests (V41-DISCOVER-1)
 *
 * These tests assert that the discover service code never reads or
 * propagates fact content. They run statically over the source files —
 * if a future change adds a `.embeddingText` read or a `content` field
 * to SimilarityMatch, the test fails before any runtime exposure.
 *
 * The discover surface's contract is:
 *   - Signatures out (centroid + aggregate stats + topic names)
 *   - Never fact content
 *   - Never Causal/Context tensors
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(__dir, '..')

const FILES = [
  'signature.ts',
  'similarity.ts',
  'governance.ts',
  'types.ts',
  'index.ts',
]

function readSource(file: string): string {
  return readFileSync(resolve(DIR, file), 'utf-8')
}

/**
 * Strip JS/TS comments so the no-leak assertions only inspect real code.
 * We intentionally list forbidden tokens in docstrings to warn future
 * maintainers — those mentions must not trigger the invariant.
 */
function stripComments(src: string): string {
  // Remove /* ... */ blocks (including JSDoc), then // line comments.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '')
}

describe('Discover service — NO-LEAK invariants', () => {
  it('no source file reads `embeddingText` (the composed fact text)', () => {
    for (const f of FILES) {
      const src = stripComments(readSource(f))
      // Token-level match — also catches .embeddingText and indexRecords.embeddingText.
      expect(
        src,
        `File ${f} contains forbidden 'embeddingText' read`
      ).not.toMatch(/embeddingText/)
    }
  })

  it('no source file references the metadata column on index_records (could carry text)', () => {
    // We allow `metadata:` on signature types (there is none), but disallow
    // `indexRecords.metadata` drizzle reads.
    for (const f of FILES) {
      const src = stripComments(readSource(f))
      expect(
        src,
        `File ${f} reads indexRecords.metadata — could leak content`
      ).not.toMatch(/indexRecords\.metadata/)
    }
  })

  it('similarity pipeline does not use Causal or Context tensors (intent leakage)', () => {
    const src = stripComments(readSource('similarity.ts'))
    expect(src, 'similarity.ts must not read embeddingCausal').not.toMatch(
      /embeddingCausal/
    )
    expect(src, 'similarity.ts must not read embeddingContext').not.toMatch(
      /embeddingContext/
    )
  })

  it('signature.ts centroid math uses only embeddingContent (Content tensor)', () => {
    const src = stripComments(readSource('signature.ts'))
    // Positive assertion — it MUST read Content.
    expect(src).toMatch(/embeddingContent/)
    // Negative assertions — it must NOT read the other two tensors.
    expect(src).not.toMatch(/embeddingCausal/)
    expect(src).not.toMatch(/embeddingContext/)
  })

  it('SimilarityMatch type carries no content field (topical overlap is strings only)', () => {
    const src = readSource('types.ts')
    // Grab the SimilarityMatch block and confirm no `content` or `text` field.
    const match = src.match(/interface SimilarityMatch[\s\S]*?^}/m)
    expect(match).toBeTruthy()
    const block = match![0]
    expect(block).not.toMatch(/\bcontent\s*:/)
    expect(block).not.toMatch(/\btext\s*:/)
    expect(block).not.toMatch(/\bembeddingText\b/)
    // Required privacy-preserving fields are present.
    expect(block).toMatch(/topicalOverlap/)
    expect(block).toMatch(/similarity/)
  })

  it('IndexSignature type exposes centroid + aggregate stats only, no fact body field', () => {
    const src = readSource('types.ts')
    const match = src.match(/interface IndexSignature[\s\S]*?^}/m)
    expect(match).toBeTruthy()
    const block = match![0]
    expect(block).not.toMatch(/\bcontent\s*:/)
    expect(block).not.toMatch(/\bembeddingText\b/)
    expect(block).toMatch(/contentCentroid/)
  })

  it('governance check is imported by similarity before any candidate signature is emitted', () => {
    const src = stripComments(readSource('similarity.ts'))
    expect(src).toMatch(/checkDiscoverableAllowed/)
    // Governance call must appear BEFORE signature enumeration — spec position check.
    const govIdx = src.indexOf('checkDiscoverableAllowed')
    const bulkSigIdx = src.indexOf('bulkSignatures')
    expect(govIdx).toBeGreaterThan(0)
    expect(bulkSigIdx).toBeGreaterThan(0)
    expect(
      govIdx,
      'Governance check must run before signatures are computed in the pipeline'
    ).toBeLessThan(bulkSigIdx)
  })

  it("redactSignature's 'topics_only' default drops contentCentroid", () => {
    const src = readSource('signature.ts')
    // Confirm the specific redaction rule that protects against centroid reconstruction.
    expect(src).toMatch(/contentCentroid: null/)
  })
})
