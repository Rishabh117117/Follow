import { describe, it, expect } from 'vitest'
import { redactSignature } from '../signature'
import type { IndexSignature } from '../types'

function makeSignature(): IndexSignature {
  return {
    indexId: 'idx-1',
    indexName: 'Test',
    ownerId: 'owner',
    ownerName: 'Owner Name',
    workspaceId: 'ws-1',
    contentCentroid: [0.1, 0.2, 0.3],
    topicalFingerprint: [
      { topic: 'capstone', weight: 0.4 },
      { topic: 'research', weight: 0.3 },
    ],
    recordCount: 40,
    lastActivityAt: new Date('2026-04-19T00:00:00Z'),
    contributorCount: 3,
    discoverable: true,
    discoverableScope: 'workspace',
  }
}

describe('redactSignature', () => {
  it('owner view returns full signature unchanged at every floor', () => {
    const sig = makeSignature()
    for (const floor of ['fingerprint_only', 'topics_only', 'full_signature'] as const) {
      const out = redactSignature(sig, floor, { isOwner: true })
      expect(out.contentCentroid).not.toBeNull()
      expect(out.topicalFingerprint).not.toBeNull()
    }
  })

  it("topics_only floor drops contentCentroid (reconstruction attack surface)", () => {
    const out = redactSignature(makeSignature(), 'topics_only')
    expect(out.contentCentroid).toBeNull()
    // Topical fingerprint preserved at this floor.
    expect(out.topicalFingerprint).not.toBeNull()
  })

  it('fingerprint_only floor drops topicalFingerprint (topic clustering could leak)', () => {
    const out = redactSignature(makeSignature(), 'fingerprint_only')
    expect(out.topicalFingerprint).toBeNull()
    // Centroid is kept for similarity math at this floor.
    expect(out.contentCentroid).not.toBeNull()
  })

  it('full_signature floor preserves everything (owner-authorized view only)', () => {
    const out = redactSignature(makeSignature(), 'full_signature')
    expect(out.contentCentroid).not.toBeNull()
    expect(out.topicalFingerprint).not.toBeNull()
  })

  it('record count is already coarse (rounded to 10) by the computer step, not redactor', () => {
    const sig = makeSignature()
    // redactor does not touch recordCount — it's already rounded upstream.
    expect(redactSignature(sig, 'topics_only').recordCount).toBe(sig.recordCount)
  })
})
