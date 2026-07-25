/**
 * Index Signature (Sprint V41-DISCOVER-1)
 *
 * Computes the privacy-preserving signature of an index. Signatures are
 * the only thing Discover hands back across index boundaries. They never
 * include raw fact content.
 *
 * Forbidden reads: `index_records.embeddingText`, `index_records.metadata`.
 * Allowed reads: `index_records.embeddingContent` (768d Content tensor),
 * `index_records.userId`, `index_records.indexedAt`, `index_records.workspaceId`,
 * `index_records.documentTitle` (used ONLY for topic derivation from title
 * tokens, never returned).
 *
 * The Causal (512d) and Context (512d) tensors are deliberately NOT used
 * for similarity. They carry WHY/WHERE and can leak intent.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexRecords } from '../../db/schema/semantic-index'
import { spaces } from '../../db/schema/spaces'
import { users } from '../../db/schema/users'
import type { IndexSignature, PrivacyFloor } from './types'

const MIN_RECORDS_FOR_CENTROID = 5
const TOPIC_TOP_K = 20
const RECENCY_HALF_LIFE_DAYS = 30
const SIGNATURE_CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  signature: IndexSignature
  at: number
}
const cache = new Map<string, CacheEntry>()

function cacheKey(indexId: string): string {
  return indexId
}

function readCache(indexId: string): IndexSignature | null {
  const entry = cache.get(cacheKey(indexId))
  if (!entry) return null
  if (Date.now() - entry.at > SIGNATURE_CACHE_TTL_MS) {
    cache.delete(cacheKey(indexId))
    return null
  }
  return entry.signature
}

function writeCache(indexId: string, signature: IndexSignature): void {
  cache.set(cacheKey(indexId), { signature, at: Date.now() })
}

export function clearSignatureCache(): void {
  cache.clear()
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Compute the full, unredacted signature for an index. Callers are
 * responsible for passing it through `redactSignature` before returning
 * to a non-owner requestor.
 *
 * "Index" here maps to a `spaces` row (project index) or a workspace-level
 * personal index. For personal indexes, `indexId` === `workspaceId`.
 */
export async function computeIndexSignature(
  indexId: string,
  opts: { isPersonalWorkspaceIndex?: boolean } = {}
): Promise<IndexSignature> {
  const cached = readCache(indexId)
  if (cached) return cached

  let indexName = 'Index'
  let ownerId: string | null = null
  let ownerName: string | null = null
  let workspaceId = indexId
  let discoverable = false
  let discoverableScope: 'workspace' | 'org' | 'public' | null = null

  if (!opts.isPersonalWorkspaceIndex) {
    const spaceRows = await db.select().from(spaces).where(eq(spaces.id, indexId)).limit(1)
    const space = spaceRows[0]
    if (space) {
      indexName = space.name
      ownerId = space.createdBy
      workspaceId = space.workspaceId
      discoverable = space.discoverable
      discoverableScope = (space.discoverableScope as typeof discoverableScope) ?? 'workspace'
      if (ownerId) {
        const ownerRows = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, ownerId))
          .limit(1)
        ownerName = ownerRows[0]?.name ?? null
      }
    }
  }

  // Pull the minimum columns needed. Explicitly EXCLUDE `embeddingText` and
  // `metadata` — those can contain fact content and MUST NOT be read here.
  const rows = await db
    .select({
      userId: indexRecords.userId,
      indexedAt: indexRecords.indexedAt,
      embeddingContent: indexRecords.embeddingContent,
      documentTitle: indexRecords.documentTitle,
      sectionAlias: indexRecords.sectionAlias,
    })
    .from(indexRecords)
    .where(
      and(
        eq(indexRecords.workspaceId, workspaceId),
        eq(indexRecords.hidden, false),
        sql`${indexRecords.deletedAt} IS NULL`
      )
    )

  // Content centroid from the 768d Content tensor only.
  const vectors = rows
    .map((r) => r.embeddingContent)
    .filter((v): v is number[] => Array.isArray(v) && v.length === 768)

  let contentCentroid: number[] | null = null
  if (vectors.length >= MIN_RECORDS_FOR_CENTROID) {
    const sum = new Array<number>(768).fill(0)
    for (const v of vectors) {
      for (let i = 0; i < 768; i++) sum[i]! += v[i]!
    }
    contentCentroid = sum.map((s) => s / vectors.length)
  }

  // Topical fingerprint — derived from documentTitle + sectionAlias token
  // frequency, recency-weighted. These are titles/headings (already coarse),
  // never fact bodies.
  const now = Date.now()
  const rawCounts = new Map<string, number>()
  for (const r of rows) {
    const tokens = extractTopicTokens(r.documentTitle, r.sectionAlias)
    const ageDays = r.indexedAt
      ? (now - r.indexedAt.getTime()) / (86_400_000)
      : RECENCY_HALF_LIFE_DAYS
    const recencyFactor = Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS)
    for (const t of tokens) {
      rawCounts.set(t, (rawCounts.get(t) ?? 0) + recencyFactor)
    }
  }

  const sorted = [...rawCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOPIC_TOP_K)
  const totalWeight = sorted.reduce((acc, [, w]) => acc + w, 0) || 1
  const topicalFingerprint = sorted.map(([topic, w]) => ({
    topic,
    weight: w / totalWeight,
  }))

  const contributorCount = new Set(rows.map((r) => r.userId)).size
  const lastActivity = rows.reduce<Date | null>((acc, r) => {
    if (!r.indexedAt) return acc
    if (!acc || r.indexedAt > acc) return r.indexedAt
    return acc
  }, null)

  const signature: IndexSignature = {
    indexId,
    indexName,
    ownerId,
    ownerName,
    workspaceId,
    contentCentroid,
    topicalFingerprint: topicalFingerprint.length > 0 ? topicalFingerprint : null,
    recordCount: roundToNearestTen(rows.length),
    lastActivityAt: lastActivity ? roundToDay(lastActivity) : null,
    contributorCount,
    discoverable,
    discoverableScope,
  }

  writeCache(indexId, signature)
  return signature
}

export async function bulkSignatures(
  indexIds: string[],
  opts: { isPersonalWorkspaceIndex?: boolean } = {}
): Promise<IndexSignature[]> {
  const results = await Promise.allSettled(
    indexIds.map((id) => computeIndexSignature(id, opts))
  )
  const out: IndexSignature[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(r.value)
    else console.warn('[discover] bulkSignature error:', r.reason)
  }
  return out
}

/**
 * Apply the privacy floor. This is the LAST step before returning a
 * signature across a trust boundary.
 *
 *   fingerprint_only — omits topicalFingerprint (tag names could cluster
 *                      to identify content), keeps centroid + coarse stats.
 *   topics_only      — DEFAULT. Keeps topic names but drops the centroid
 *                      (centroids enable reconstruction attacks).
 *   full_signature   — owner-authorized view only. Keeps everything.
 */
export function redactSignature(
  sig: IndexSignature,
  floor: PrivacyFloor,
  opts: { isOwner?: boolean } = {}
): IndexSignature {
  // Owners always see the full signature of their own indexes; the floor
  // only constrains the cross-user view.
  if (opts.isOwner) return sig

  switch (floor) {
    case 'full_signature':
      return sig
    case 'fingerprint_only':
      return {
        ...sig,
        // Keep centroid (caller is presumably doing similarity math).
        topicalFingerprint: null,
        ownerId: sig.ownerId,
        ownerName: sig.ownerName,
      }
    case 'topics_only':
    default:
      return {
        ...sig,
        // Drop centroid — reconstruction attack surface.
        contentCentroid: null,
        // Keep topics but they've already been redacted to just names (no content).
        topicalFingerprint: sig.topicalFingerprint,
        // Identity is visible in topics_only (default) — owners can be
        // hidden by downgrading the floor on an org-policy basis.
      }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTopicTokens(
  title: string | null | undefined,
  section: string | null | undefined
): string[] {
  const sources: string[] = []
  if (title) sources.push(title)
  if (section) sources.push(section)
  const text = sources.join(' ').toLowerCase()
  if (!text) return []
  // Split on non-word, drop stopwords/short tokens. Coarse on purpose —
  // this is aggregate signal, not NLP.
  const tokens = text.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  return [...new Set(tokens)]
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'but',
  'not',
  'any',
  'you',
  'your',
  'our',
  'out',
  'ops',
  'doc',
  'docs',
  'page',
  'pages',
  'note',
  'notes',
  'file',
  'files',
])

function roundToNearestTen(n: number): number {
  return Math.round(n / 10) * 10
}

function roundToDay(d: Date): Date {
  const copy = new Date(d)
  copy.setUTCHours(0, 0, 0, 0)
  return copy
}
