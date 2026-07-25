/**
 * Discover Similarity (Sprint V41-DISCOVER-1)
 *
 * Pipeline:
 *   1. Resolve the `source` into an IndexSignature (or derived centroid).
 *   2. Enumerate candidate indexes with `discoverable = true`.
 *   3. Governance-gate each candidate (see governance.ts). Fail-closed.
 *   4. Cosine-similarity the candidate's centroid against the source centroid.
 *   5. Redact each surviving signature per the requestor's privacyFloor.
 *   6. Shape the SimilarityMatch[] — topical OVERLAP only (intersection of
 *      tag names), no weights, no content.
 *
 * Never returns fact content. `SimilarityResult.matches[].topicalOverlap`
 * is string-only and derives from the redacted fingerprint's topic names.
 */

import { and, eq, ne, not, sql } from 'drizzle-orm'
import { db } from '../../db/index'
import { spaces } from '../../db/schema/spaces'
import { checkDiscoverableAllowed } from './governance'
import {
  bulkSignatures,
  computeIndexSignature,
  redactSignature,
} from './signature'
import type {
  DiscoverConflict,
  DiscoverParams,
  IndexSignature,
  PrivacyFloor,
  SimilarityMatch,
  SimilarityResult,
} from './types'

const DEFAULT_PRIVACY_FLOOR: PrivacyFloor = 'topics_only'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SIMILARITY_THRESHOLD = 0.25

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function findSimilarIndexes(
  params: DiscoverParams,
  requestor: { userId: string; workspaceId: string }
): Promise<SimilarityResult> {
  const startedAt = Date.now()
  const privacyFloor = params.privacyFloor ?? DEFAULT_PRIVACY_FLOOR
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const conflicts: DiscoverConflict[] = []

  // ─── 1. Resolve source signature ──────────────────────────────────────────
  let sourceSignature: IndexSignature
  let sourceIndexId: string
  let sourceIndexName: string

  if (params.source.kind === 'index') {
    sourceIndexId = params.source.value
    sourceSignature = await computeIndexSignature(sourceIndexId)
    sourceIndexName = sourceSignature.indexName
  } else if (params.source.kind === 'contributor') {
    // MVP: treat a contributor source as the personal-workspace index of the
    // contributor. This requires the requestor to be that contributor (else
    // fail closed — no cross-user personal-index discovery).
    if (params.source.value !== requestor.userId) {
      return emptyResult(
        params.source.value,
        'contributor:' + params.source.value,
        privacyFloor,
        0,
        startedAt,
        [
          {
            type: 'requestor_ineligible',
            reason:
              "Cross-user contributor-source discovery is not supported. Use 'source.kind=index' with a discoverable index instead.",
          },
        ]
      )
    }
    sourceIndexId = requestor.workspaceId
    sourceSignature = await computeIndexSignature(sourceIndexId, {
      isPersonalWorkspaceIndex: true,
    })
    sourceIndexName = 'Personal'
  } else {
    // 'topic' — derive a pseudo-centroid from the topic token alone. Coarse
    // but serves as a filter to rank candidates by topical overlap.
    sourceIndexId = `topic:${params.source.value}`
    sourceIndexName = `Topic: ${params.source.value}`
    sourceSignature = {
      indexId: sourceIndexId,
      indexName: sourceIndexName,
      ownerId: requestor.userId,
      ownerName: null,
      workspaceId: requestor.workspaceId,
      contentCentroid: null, // topic-derived centroids not supported in MVP
      topicalFingerprint: [{ topic: params.source.value.toLowerCase(), weight: 1 }],
      recordCount: 0,
      lastActivityAt: null,
      contributorCount: 0,
      discoverable: false,
      discoverableScope: null,
    }
  }

  // ─── 2. Enumerate candidates ──────────────────────────────────────────────
  const minRecordCount = params.scope?.minRecordCount ?? 10
  const candidateRows = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.discoverable, true),
        ne(spaces.id, sourceIndexId),
        // Not soft-deleted.
        sql`${spaces.deletedAt} IS NULL`
      )
    )
    .limit(500) // hard cap on scanned candidates

  // ─── 3. Governance-gate each candidate (fail-closed). ─────────────────────
  const allowed: string[] = []
  for (const c of candidateRows) {
    const r = await checkDiscoverableAllowed({
      candidateIndexId: c.id,
      requestorId: requestor.userId,
      requestorWorkspaceId: requestor.workspaceId,
    })
    if (r.allowed) {
      allowed.push(c.id)
    } else if (r.conflict) {
      // Record conflict but never leak the candidate's existence via reason.
      conflicts.push({ ...r.conflict, indexId: undefined })
    }
  }

  // ─── 4. Compute candidate signatures + score ──────────────────────────────
  const signatures = await bulkSignatures(allowed)
  const scored: Array<{ sig: IndexSignature; score: number }> = []
  for (const sig of signatures) {
    if (sig.recordCount < minRecordCount) {
      conflicts.push({
        type: 'insufficient_signal',
        reason: `An index was skipped because it had fewer than ${minRecordCount} records.`,
      })
      continue
    }
    let score = 0
    if (
      sourceSignature.contentCentroid &&
      sig.contentCentroid &&
      sig.contentCentroid.length === sourceSignature.contentCentroid.length
    ) {
      score = cosineSimilarity(sourceSignature.contentCentroid, sig.contentCentroid)
    } else if (sourceSignature.topicalFingerprint && sig.topicalFingerprint) {
      // Fallback: Jaccard over top-K topic names when centroids aren't available.
      const sourceTags = new Set(sourceSignature.topicalFingerprint.map((t) => t.topic))
      const candTags = new Set(sig.topicalFingerprint.map((t) => t.topic))
      const intersect = [...sourceTags].filter((t) => candTags.has(t)).length
      const union = new Set([...sourceTags, ...candTags]).size || 1
      score = intersect / union
    }
    if (score >= SIMILARITY_THRESHOLD) {
      scored.push({ sig, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, limit)

  // ─── 5. Redact + shape ────────────────────────────────────────────────────
  const sourceTopicSet = new Set(
    (sourceSignature.topicalFingerprint ?? []).map((t) => t.topic)
  )

  const matches: SimilarityMatch[] = top.map(({ sig, score }) => {
    const isOwner = sig.ownerId === requestor.userId
    const redacted = redactSignature(sig, privacyFloor, { isOwner })
    const candTopics = redacted.topicalFingerprint?.map((t) => t.topic) ?? []
    const overlap = candTopics.filter((t) => sourceTopicSet.has(t))
    return {
      indexId: redacted.indexId,
      indexName: redacted.indexName,
      // Under 'fingerprint_only' we keep owner identity (no content signal
      // in identity alone); under 'topics_only' we also keep it by default;
      // policies can be tightened later at the governance layer.
      ownerId: redacted.ownerId,
      ownerName: redacted.ownerName,
      similarity: Number(score.toFixed(4)),
      // Topical overlap is strings-only (topic names), no weights, no text.
      topicalOverlap: overlap,
      recordCount: redacted.recordCount,
      lastActivityAt: redacted.lastActivityAt,
    }
  })

  return {
    sourceIndexId,
    sourceIndexName,
    matches,
    privacyFloor,
    scanned: candidateRows.length,
    runtimeMs: Date.now() - startedAt,
    conflicts,
  }
}

function emptyResult(
  sourceIndexId: string,
  sourceIndexName: string,
  privacyFloor: PrivacyFloor,
  scanned: number,
  startedAt: number,
  conflicts: DiscoverConflict[]
): SimilarityResult {
  return {
    sourceIndexId,
    sourceIndexName,
    matches: [],
    privacyFloor,
    scanned,
    runtimeMs: Date.now() - startedAt,
    conflicts,
  }
}
