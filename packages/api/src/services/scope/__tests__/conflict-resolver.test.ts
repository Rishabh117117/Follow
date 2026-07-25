import { describe, it, expect } from 'vitest'
import {
  resolveAgainstGovernance,
  resolveCrossUser,
} from '../conflict-resolver'
import { buildScopeFromBoundaries } from '../scope-builder'
import type { Boundary, GovernanceSnapshot } from '../types'

function gov(partial: Partial<GovernanceSnapshot> = {}): GovernanceSnapshot {
  return {
    activePreset: 'balanced',
    userId: 'u1',
    workspaceId: 'w1',
    blockedIndexIds: [],
    blockedContributorIds: [],
    ...partial,
  }
}

describe('resolveAgainstGovernance', () => {
  it('keeps all boundaries when nothing is blocked', () => {
    const bs: Boundary[] = [{ dimension: 'confidence', op: 'gte', value: 0.8 }]
    const scope = buildScopeFromBoundaries({
      userId: 'u1',
      workspaceId: 'w1',
      boundaries: bs,
    })
    const r = resolveAgainstGovernance(scope, gov())
    expect(r.scope.boundaries).toEqual(bs)
    expect(r.conflicts).toEqual([])
  })

  it('blocks private-preset contributor boundaries naming other users', () => {
    const bs: Boundary[] = [
      { dimension: 'contributor', op: 'include', values: ['other-user-id'] },
    ]
    const scope = buildScopeFromBoundaries({
      userId: 'u1',
      workspaceId: 'w1',
      boundaries: bs,
    })
    const r = resolveAgainstGovernance(scope, gov({ activePreset: 'private' }))

    expect(r.scope.boundaries).toEqual([])
    expect(r.conflicts).toHaveLength(1)
    const first = r.conflicts[0]!
    expect(first.type).toBe('vs_governance')
    expect(first.resolution.action).toBe('request_access')
    expect(first.resolution.next_step).toContain('other-user-id')
  })

  it('blocks index boundaries naming inaccessible indexes', () => {
    const bs: Boundary[] = [
      { dimension: 'index', op: 'include', values: ['blocked-idx'] },
    ]
    const scope = buildScopeFromBoundaries({
      userId: 'u1',
      workspaceId: 'w1',
      boundaries: bs,
    })
    const r = resolveAgainstGovernance(
      scope,
      gov({ blockedIndexIds: ['blocked-idx'] })
    )
    expect(r.scope.boundaries).toEqual([])
    const c = r.conflicts[0]!
    expect(c.resolution.action).toBe('request_access')
    expect(c.governance?.severity).toBe('hard')
  })

  it('does NOT silently downgrade — blocked boundaries are dropped with a visible conflict', () => {
    const bs: Boundary[] = [
      { dimension: 'confidence', op: 'gte', value: 0.8 },
      { dimension: 'contributor', op: 'include', values: ['other'] },
    ]
    const scope = buildScopeFromBoundaries({
      userId: 'u1',
      workspaceId: 'w1',
      boundaries: bs,
    })
    const r = resolveAgainstGovernance(scope, gov({ activePreset: 'private' }))
    // confidence survived, contributor didn't
    expect(r.scope.boundaries.map((b) => b.dimension)).toEqual(['confidence'])
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0]!.resolution.action).not.toBe('downgrade')
  })
})

describe('resolveCrossUser', () => {
  it("applies receiver's scope unchanged when scopes differ", () => {
    const incoming = buildScopeFromBoundaries({
      userId: 'sharer',
      workspaceId: 'w',
      boundaries: [{ dimension: 'confidence', op: 'gte', value: 0.9 }],
    })
    const receiver = buildScopeFromBoundaries({
      userId: 'receiver',
      workspaceId: 'w',
      boundaries: [{ dimension: 'confidence', op: 'gte', value: 0.6 }],
    })
    const r = resolveCrossUser(incoming, receiver)
    expect(r.scope).toBe(receiver)
    expect(r.conflict?.resolution.action).toBe('apply_receiver_scope')
  })

  it('returns no conflict when scopes match', () => {
    const bs: Boundary[] = [{ dimension: 'confidence', op: 'gte', value: 0.8 }]
    const incoming = buildScopeFromBoundaries({
      userId: 'a',
      workspaceId: 'w',
      boundaries: bs,
    })
    const receiver = buildScopeFromBoundaries({
      userId: 'b',
      workspaceId: 'w',
      boundaries: bs,
    })
    const r = resolveCrossUser(incoming, receiver)
    expect(r.conflict).toBeNull()
  })
})
