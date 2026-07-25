/**
 * Discover Types (Sprint V41-DISCOVER-1)
 *
 * Hard invariants encoded in these types:
 *   - IndexSignature never carries fact text. `contentCentroid` is a vector;
 *     `topicalFingerprint` is aggregated tag weights; no raw content.
 *   - SimilarityResult carries topical OVERLAP (intersection of tag names),
 *     not weights and not content. `ownerId` may be null under strict
 *     privacy floors.
 */

export type PrivacyFloor = 'fingerprint_only' | 'topics_only' | 'full_signature'

export interface IndexSignature {
  indexId: string
  indexName: string
  /** Redacted (null) under `topics_only` + non-owner requestor. */
  ownerId: string | null
  ownerName: string | null
  workspaceId: string
  /** 768-dim centroid from index_records.embedding_content. Null when record count < 5. */
  contentCentroid: number[] | null
  /** Top-K tags with recency-weighted frequency. Null under `fingerprint_only`. */
  topicalFingerprint: Array<{ topic: string; weight: number }> | null
  /** Rounded to nearest 10 — never exact. */
  recordCount: number
  /** Day-rounded. */
  lastActivityAt: Date | null
  contributorCount: number
  discoverable: boolean
  discoverableScope: 'workspace' | 'org' | 'public' | null
}

export interface SimilarityMatch {
  indexId: string
  indexName: string
  ownerId: string | null
  ownerName: string | null
  /** Cosine 0..1. */
  similarity: number
  /** Intersection of top-K tag names — topic strings only, no weights. */
  topicalOverlap: string[]
  recordCount: number
  lastActivityAt: Date | null
}

export interface DiscoverConflict {
  type: 'workspace_policy' | 'owner_optout' | 'insufficient_signal' | 'requestor_ineligible'
  indexId?: string
  reason: string
  next_step?: string
}

export interface SimilarityResult {
  sourceIndexId: string
  sourceIndexName: string
  matches: SimilarityMatch[]
  privacyFloor: PrivacyFloor
  /** How many candidate indexes were compared against. */
  scanned: number
  runtimeMs: number
  conflicts: DiscoverConflict[]
}

export interface DiscoverParams {
  source:
    | { kind: 'index'; value: string }
    | { kind: 'contributor'; value: string }
    | { kind: 'topic'; value: string }
  scope?: {
    workspace?: string
    org?: boolean
    minRecordCount?: number
  }
  privacyFloor?: PrivacyFloor
  limit?: number
}
