import { create } from 'zustand'

/**
 * Provenance v2 store — manages attribution tracking, expandable events,
 * and text diff state for the enhanced provenance panel.
 */

/**
 * Attribution source for a paragraph or section of text.
 */
export type AttributionSource = 'human' | 'ai' | 'mixed' | 'unknown'

export interface ParagraphAttribution {
  /** Paragraph index (0-based) in the document */
  index: number
  /** First ~80 chars of the paragraph text */
  preview: string
  /** Who authored this content */
  source: AttributionSource
  /** Percentage of AI contribution (0-100) for mixed */
  aiPercent: number
  /** Last edit timestamp */
  lastEditAt: string
  /** Model name if AI-generated */
  model?: string
  /** Related event ID from thread_events */
  eventId?: string
}

/**
 * Text diff entry — represents a before/after change.
 */
export type DiffSegmentType = 'added' | 'removed' | 'unchanged'

export interface DiffSegment {
  type: DiffSegmentType
  text: string
}

export interface TextDiffEntry {
  id: string
  eventId: string
  timestamp: string
  label: string
  /** Computed diff segments for inline rendering */
  segments: DiffSegment[]
  /** Original full text */
  beforeText: string
  /** Changed full text */
  afterText: string
}

interface ProvenanceState {
  /** Per-paragraph attribution data */
  attributions: ParagraphAttribution[]
  /** Expanded event IDs in the timeline */
  expandedEventIds: Set<string>
  /** Text diffs keyed by event ID */
  diffs: Map<string, TextDiffEntry>
  /** Whether the attribution sidebar is visible */
  showAttributions: boolean
  /** Currently hovered paragraph index (-1 = none) */
  hoveredParagraph: number

  // Actions
  setAttributions: (attrs: ParagraphAttribution[]) => void
  toggleEvent: (eventId: string) => void
  expandEvent: (eventId: string) => void
  collapseEvent: (eventId: string) => void
  collapseAll: () => void
  setDiff: (eventId: string, diff: TextDiffEntry) => void
  setShowAttributions: (show: boolean) => void
  setHoveredParagraph: (index: number) => void
  reset: () => void
}

export const useProvenanceStore = create<ProvenanceState>((set) => ({
  attributions: [],
  expandedEventIds: new Set<string>(),
  diffs: new Map<string, TextDiffEntry>(),
  showAttributions: false,
  hoveredParagraph: -1,

  setAttributions: (attrs) => set({ attributions: attrs }),

  toggleEvent: (eventId) =>
    set((s) => {
      const next = new Set(s.expandedEventIds)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return { expandedEventIds: next }
    }),

  expandEvent: (eventId) =>
    set((s) => {
      const next = new Set(s.expandedEventIds)
      next.add(eventId)
      return { expandedEventIds: next }
    }),

  collapseEvent: (eventId) =>
    set((s) => {
      const next = new Set(s.expandedEventIds)
      next.delete(eventId)
      return { expandedEventIds: next }
    }),

  collapseAll: () => set({ expandedEventIds: new Set() }),

  setDiff: (eventId, diff) =>
    set((s) => {
      const next = new Map(s.diffs)
      next.set(eventId, diff)
      return { diffs: next }
    }),

  setShowAttributions: (show) => set({ showAttributions: show }),

  setHoveredParagraph: (index) => set({ hoveredParagraph: index }),

  reset: () =>
    set({
      attributions: [],
      expandedEventIds: new Set(),
      diffs: new Map(),
      showAttributions: false,
      hoveredParagraph: -1,
    }),
}))

// ─── Diff computation utility ────────────────────────────────────────────────

/**
 * Compute a simple word-level diff between two strings.
 * Returns an array of DiffSegments for inline rendering.
 */
export function computeWordDiff(before: string, after: string): DiffSegment[] {
  const beforeWords = before.split(/(\s+)/)
  const afterWords = after.split(/(\s+)/)
  const segments: DiffSegment[] = []

  // Simple LCS-based diff at word level
  const lcs = buildLCS(beforeWords, afterWords)
  let bi = 0
  let ai = 0
  let li = 0

  while (bi < beforeWords.length || ai < afterWords.length) {
    if (li < lcs.length && bi < beforeWords.length && ai < afterWords.length && beforeWords[bi] === lcs[li] && afterWords[ai] === lcs[li]) {
      // Common word
      segments.push({ type: 'unchanged', text: lcs[li]! })
      bi++
      ai++
      li++
    } else if (li < lcs.length && bi < beforeWords.length && beforeWords[bi] !== lcs[li]) {
      // Removed word
      segments.push({ type: 'removed', text: beforeWords[bi]! })
      bi++
    } else if (li < lcs.length && ai < afterWords.length && afterWords[ai] !== lcs[li]) {
      // Added word
      segments.push({ type: 'added', text: afterWords[ai]! })
      ai++
    } else if (li >= lcs.length && bi < beforeWords.length) {
      // Remaining removed
      segments.push({ type: 'removed', text: beforeWords[bi]! })
      bi++
    } else if (li >= lcs.length && ai < afterWords.length) {
      // Remaining added
      segments.push({ type: 'added', text: afterWords[ai]! })
      ai++
    } else {
      break
    }
  }

  // Merge consecutive segments of same type
  return mergeSegments(segments)
}

/** Build LCS (Longest Common Subsequence) of two word arrays */
function buildLCS(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  // Backtrack to get the LCS
  const result: string[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]!)
      i--
      j--
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--
    } else {
      j--
    }
  }

  return result
}

/** Merge consecutive segments of the same type */
function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  if (segments.length === 0) return []

  const merged: DiffSegment[] = [segments[0]!]
  for (let i = 1; i < segments.length; i++) {
    const last = merged[merged.length - 1]!
    const curr = segments[i]!
    if (last.type === curr.type) {
      last.text += curr.text
    } else {
      merged.push({ ...curr })
    }
  }
  return merged
}

/**
 * Get a human-readable label for an attribution source.
 */
export function getAttributionLabel(source: AttributionSource): string {
  switch (source) {
    case 'human':
      return 'Written by you'
    case 'ai':
      return 'AI-generated'
    case 'mixed':
      return 'Co-authored'
    case 'unknown':
      return 'Unknown origin'
  }
}

/**
 * Get color for attribution source (CSS variable safe).
 */
export function getAttributionColor(source: AttributionSource): string {
  switch (source) {
    case 'human':
      return '#059669' // emerald
    case 'ai':
      return '#7C3AED' // violet
    case 'mixed':
      return '#2563EB' // blue
    case 'unknown':
      return '#9CA3AF' // gray
  }
}
