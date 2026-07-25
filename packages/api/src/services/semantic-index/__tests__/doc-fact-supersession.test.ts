import { describe, it, expect } from 'vitest'
import { planDocSupersession, type ExistingDocFact } from '../doc-fact-extractor'

// VERSION-B1 — planDocSupersession is the pure decision behind re-sync supersession:
// given a file's existing facts, the content hashes present in the NEW document
// version, and the new version number, decide which facts carry forward (content
// still present → re-stamp to N, revive if previously superseded) vs are superseded
// (content gone AND from an older version). The DB-bound flow (the two UPDATEs,
// version stamping, indexDistilledEvents routing) is verified end-to-end in Phase 4.

function fact(
  id: string,
  hash: string,
  sourceVersion: number | null,
  superseded = false
): ExistingDocFact {
  return { id, hash, sourceVersion, supersededAt: superseded ? new Date(0) : null }
}

describe('VERSION-B1 · planDocSupersession', () => {
  it('first index (no existing facts) carries nothing and supersedes nothing', () => {
    const plan = planDocSupersession([], new Set(['a', 'b']), 1)
    expect(plan.carryForwardIds).toEqual([])
    expect(plan.supersededIds).toEqual([])
  })

  it('a file already current at v1 (identical re-run, same version) supersedes nothing', () => {
    const existing = [fact('r1', 'a', 1), fact('r2', 'b', 1)]
    const plan = planDocSupersession(existing, new Set(['a', 'b']), 1)
    expect(plan.supersededIds).toEqual([])
    expect(plan.carryForwardIds).toEqual([]) // already current at N and live → no-op
  })

  it('changed re-sync to v2 supersedes the REMOVED v1 fact, not the survivors', () => {
    // v1 facts A, B unchanged; C removed. (New content D is not in `existing` —
    // it is inserted separately, not part of the plan.)
    const existing = [fact('rA', 'a', 1), fact('rB', 'b', 1), fact('rC', 'c', 1)]
    const incoming = new Set(['a', 'b', 'd']) // A,B still present; D new; C gone
    const plan = planDocSupersession(existing, incoming, 2)
    expect(new Set(plan.carryForwardIds)).toEqual(new Set(['rA', 'rB'])) // → re-stamped to v2
    expect(plan.supersededIds).toEqual(['rC']) // removed content retired
  })

  it('removal-only edit (no new content) still supersedes the removed fact', () => {
    const existing = [fact('rA', 'a', 1), fact('rB', 'b', 1)]
    const plan = planDocSupersession(existing, new Set(['a']), 2) // B removed
    expect(plan.carryForwardIds).toEqual(['rA'])
    expect(plan.supersededIds).toEqual(['rB'])
  })

  it('carries an unchanged fact forward across a version bump (re-stamp to N)', () => {
    const existing = [fact('rA', 'a', 1)]
    const plan = planDocSupersession(existing, new Set(['a']), 3) // same content, version bumped
    expect(plan.carryForwardIds).toEqual(['rA'])
    expect(plan.supersededIds).toEqual([])
  })

  it('revives a previously-superseded fact when its content reappears', () => {
    const existing = [fact('rA', 'a', 1, /* superseded */ true), fact('rB', 'b', 2)]
    const plan = planDocSupersession(existing, new Set(['a', 'b']), 3)
    expect(new Set(plan.carryForwardIds)).toEqual(new Set(['rA', 'rB'])) // A revived, B re-stamped
    expect(plan.supersededIds).toEqual([])
  })

  it('is a no-op for a fact already exactly current (version === N, live)', () => {
    const existing = [fact('rA', 'a', 2)]
    const plan = planDocSupersession(existing, new Set(['a']), 2)
    expect(plan.carryForwardIds).toEqual([]) // already current → not touched
    expect(plan.supersededIds).toEqual([])
  })

  it('leaves an unversioned (null source_version) fact untouched even if its content is gone', () => {
    const existing = [fact('rX', 'x', null)]
    const plan = planDocSupersession(existing, new Set(['y']), 2) // X gone, but unversioned
    expect(plan.carryForwardIds).toEqual([])
    expect(plan.supersededIds).toEqual([]) // cannot version-reason → never retired
  })

  it('THE SAFETY GUARANTEE: a fact whose content is still present is NEVER superseded', () => {
    const existing = [fact('rA', 'a', 1), fact('rB', 'b', 1), fact('rC', 'c', 1)]
    const plan = planDocSupersession(existing, new Set(['a', 'b', 'c']), 5)
    expect(plan.supersededIds).toEqual([])
    expect(new Set(plan.carryForwardIds)).toEqual(new Set(['rA', 'rB', 'rC']))
  })
})
