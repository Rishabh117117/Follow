/**
 * Weighted Referencing Engine (Sprint IX-1)
 *
 * Pure scoring engine. Takes candidate index records and a query context,
 * returns scored results using configurable weight profiles.
 *
 * Six weight profiles (history, focused, realtime, ai_usage, proactive, evidence)
 * Six signals (semantic, recency, magnitude, engagement, structural, authorship)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WeightProfile {
  semantic: number   // weight for semantic similarity (cosine)
  recency: number    // weight for recency (time decay)
  magnitude: number  // weight for event magnitude
  engagement: number // weight for engagement depth
  structural: number // weight for structural proximity (section match)
  authorship: number // weight for authorship affinity
}

export interface ScoredResult {
  recordId: string
  score: number
  signals: {
    semantic: number
    recency: number
    magnitude: number
    engagement: number
    structural: number
    authorship: number
  }
  // pass-through from candidate
  record: CandidateRecord
}

export interface CandidateRecord {
  id: string
  workspaceId: string
  threadId: string
  threadType: string
  indexMagnitude: string
  isKeyChange: boolean
  isAIInvolved: boolean
  hasEvidence: boolean
  engagementDepth: number
  episodeId: string | null
  documentId: string | null
  documentTitle: string | null
  sectionAlias: string | null
  userId: string
  userName: string | null
  eventTime: Date | string
  embeddingText: string
  embedding: number[] | null
  metadata: Record<string, unknown>
  // Sprint FE-5 (Gap 2): IX-8 version-linking columns surfaced through to
  // result mapping. Optional because (a) all four DB columns are nullable
  // and (b) existing test fixtures predate IX-8 — keeping these optional
  // avoids forcing every mock to specify them.
  sourceFileId?: string | null
  sourceVersion?: number | null
  sourceContentHash?: string | null
  indexedAt?: Date | string | null
}

// ─── Weight Profiles ─────────────────────────────────────────────────────────

export const WEIGHT_PROFILES: Record<string, WeightProfile> = {
  history:   { semantic: 0.10, recency: 0.30, magnitude: 0.25, engagement: 0.15, structural: 0.15, authorship: 0.05 },
  focused:   { semantic: 0.35, recency: 0.10, magnitude: 0.10, engagement: 0.15, structural: 0.25, authorship: 0.05 },
  realtime:  { semantic: 0.00, recency: 0.60, magnitude: 0.10, engagement: 0.00, structural: 0.20, authorship: 0.10 },
  ai_usage:  { semantic: 0.15, recency: 0.15, magnitude: 0.20, engagement: 0.20, structural: 0.20, authorship: 0.10 },
  proactive: { semantic: 0.30, recency: 0.15, magnitude: 0.10, engagement: 0.30, structural: 0.10, authorship: 0.05 },
  evidence:  { semantic: 0.00, recency: 0.00, magnitude: 0.00, engagement: 0.00, structural: 0.00, authorship: 0.00 },
}

export const THRESHOLDS: Record<string, number> = {
  history: 0.15,
  focused: 0.40,
  realtime: 0.20,
  ai_usage: 0.30,
  proactive: 0.70,
  evidence: 0.00,
}

export const MAGNITUDE_SCORES: Record<string, number> = {
  tiny: 0.1,
  small: 0.25,
  medium: 0.5,
  large: 0.75,
  major: 1.0,
}

const KEY_CHANGE_BONUS = 0.2

// ─── Signal Computations ─────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors. Returns 0 if either is null/empty.
 */
export function cosineSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Recency signal: exponential decay based on hours since event.
 * Returns 1.0 for events happening now, approaching 0 for old events.
 */
export function computeRecency(eventTime: Date | string, now: Date = new Date()): number {
  const eventDate = typeof eventTime === 'string' ? new Date(eventTime) : eventTime
  const hoursSince = Math.max(0, (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60))
  return 1.0 / (1.0 + hoursSince / 24)
}

/**
 * Magnitude signal: fixed score from magnitude tier + keyChange bonus.
 */
export function computeMagnitude(indexMagnitude: string, isKeyChange: boolean): number {
  const base = MAGNITUDE_SCORES[indexMagnitude] ?? 0.25
  return Math.min(1.0, base + (isKeyChange ? KEY_CHANGE_BONUS : 0))
}

/**
 * Structural proximity: how close is the candidate to the target section?
 * Returns 1.0 for exact match, 0.5 for same doc (different section), 0.3 otherwise.
 */
export function computeStructural(
  candidateDocId: string | null,
  candidateSection: string | null,
  targetDocId: string | null,
  targetSection: string | null
): number {
  if (!candidateDocId || !targetDocId) return 0.3
  if (candidateDocId !== targetDocId) return 0.1
  // Same document
  if (!candidateSection || !targetSection) return 0.5
  if (candidateSection.toLowerCase() === targetSection.toLowerCase()) return 1.0
  return 0.5
}

/**
 * Authorship affinity: how related is the candidate's author to the requester?
 */
export function computeAuthorship(
  candidateUserId: string,
  requestingUserId: string,
  collaboratorIds: string[]
): number {
  if (candidateUserId === requestingUserId) return 0.6
  if (collaboratorIds.includes(candidateUserId)) return 0.4
  return 0.2
}

// ─── Main Scoring Function ──────────────────────────────────────────────────

export interface ScoreContext {
  queryType: string
  queryEmbedding: number[] | null
  targetDocumentId: string | null
  targetSection: string | null
  requestingUserId: string
  collaboratorIds: string[]
}

/**
 * Score and rank candidate records using the specified weight profile.
 * Returns sorted results above the threshold for the given query type.
 */
export function scoreResults(
  candidates: CandidateRecord[],
  context: ScoreContext
): ScoredResult[] {
  const profile = WEIGHT_PROFILES[context.queryType] ?? WEIGHT_PROFILES['history']!
  const threshold = THRESHOLDS[context.queryType] ?? 0.15
  if (!profile) return []

  // Evidence query bypasses scoring — return all candidates
  if (context.queryType === 'evidence') {
    return candidates.map((record) => ({
      recordId: record.id,
      score: 1.0,
      signals: { semantic: 0, recency: 0, magnitude: 0, engagement: 0, structural: 0, authorship: 0 },
      record,
    }))
  }

  const now = new Date()

  const scored = candidates.map((record): ScoredResult => {
    const signals = {
      semantic: cosineSimilarity(context.queryEmbedding, record.embedding),
      recency: computeRecency(record.eventTime, now),
      magnitude: computeMagnitude(record.indexMagnitude, record.isKeyChange),
      engagement: record.engagementDepth,
      structural: computeStructural(
        record.documentId,
        record.sectionAlias,
        context.targetDocumentId,
        context.targetSection
      ),
      authorship: computeAuthorship(
        record.userId,
        context.requestingUserId,
        context.collaboratorIds
      ),
    }

    const score =
      profile.semantic * signals.semantic +
      profile.recency * signals.recency +
      profile.magnitude * signals.magnitude +
      profile.engagement * signals.engagement +
      profile.structural * signals.structural +
      profile.authorship * signals.authorship

    return { recordId: record.id, score, signals, record }
  })

  return scored
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
}

// ─── Tensor Facet Weight Profiles (Sprint IX-7) ────────────────────────────

export interface WeightProfileV2 {
  content: number
  context: number
  causal: number
  recency: number
  magnitude: number
  engagement: number
  structural: number
  authorship: number
}

export const WEIGHT_PROFILES_V2: Record<string, WeightProfileV2> = {
  history:    { content: 0.05, context: 0.05, causal: 0.00, recency: 0.30, magnitude: 0.25, engagement: 0.15, structural: 0.15, authorship: 0.05 },
  focused:    { content: 0.20, context: 0.10, causal: 0.15, recency: 0.10, magnitude: 0.10, engagement: 0.10, structural: 0.15, authorship: 0.10 },
  why_query:  { content: 0.10, context: 0.05, causal: 0.40, recency: 0.10, magnitude: 0.10, engagement: 0.10, structural: 0.10, authorship: 0.05 },
  who_query:  { content: 0.05, context: 0.05, causal: 0.05, recency: 0.10, magnitude: 0.10, engagement: 0.10, structural: 0.05, authorship: 0.50 },
  realtime:   { content: 0.00, context: 0.05, causal: 0.00, recency: 0.60, magnitude: 0.10, engagement: 0.00, structural: 0.15, authorship: 0.10 },
  ai_usage:   { content: 0.10, context: 0.10, causal: 0.10, recency: 0.15, magnitude: 0.15, engagement: 0.20, structural: 0.10, authorship: 0.10 },
  proactive:  { content: 0.15, context: 0.05, causal: 0.20, recency: 0.15, magnitude: 0.10, engagement: 0.25, structural: 0.05, authorship: 0.05 },
  evidence:   { content: 0.00, context: 0.00, causal: 0.00, recency: 0.00, magnitude: 0.00, engagement: 0.00, structural: 0.00, authorship: 0.00 },
}

/**
 * Detect query profile from query text (Sprint IX-7).
 */
export function detectQueryProfile(queryText: string | undefined, requestedProfile: string): string {
  if (requestedProfile !== 'focused' || !queryText) return requestedProfile
  const lower = queryText.toLowerCase()
  if (/\b(why|how come|what caused|what led to|reason for)\b/.test(lower)) return 'why_query'
  if (/\b(who|what did \w+|which user|which person|contributor)\b/.test(lower)) return 'who_query'
  return requestedProfile
}
