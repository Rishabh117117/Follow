/**
 * Doc-fact salience gate (DOC-FACTS-B0)
 *
 * Pure selection applied BEFORE any doc fact is written, in this order:
 *   1. Importance threshold — drop low-salience (boilerplate/filler) chunks.
 *   2. Content-hash dedup — drop chunks whose content is already indexed for
 *      this source file (so identical re-index produces zero new facts), plus
 *      intra-batch duplicates (a doc repeating a paragraph yields one fact).
 *   3. Per-doc cap — bound a pathological document to the N most-important
 *      chunks.
 *
 * No DB, no I/O: the caller supplies the set of already-indexed content hashes.
 * This is the gate that (a) keeps doc facts from flooding retrieval and (b)
 * closes the blind-append-on-reindex behavior for documents.
 */
import { computeContentHash } from './content-hash'

export interface DocChunkForIndex {
  chunkIndex: number
  text: string
  summary?: string | null
  topics?: string[] | null
  importance?: number | null
  sectionTitle?: string | null
  entities?: {
    people?: string[]
    decisions?: string[]
    dates?: string[]
    actionItems?: string[]
  } | null
}

export interface SelectedDocChunk {
  chunk: DocChunkForIndex
  contentHash: string
}

export interface SalienceOptions {
  importanceThreshold?: number
  perDocCap?: number
}

export interface SalienceResult {
  selected: SelectedDocChunk[]
  droppedLowSalience: number
  droppedDuplicate: number
  droppedOverCap: number
}

// ─── Salience constants (config, not magic numbers) ──────────────────────────
// Enrichment importance is 0..1 (1.0 = key decision/conclusion, 0.1 =
// boilerplate/filler — see indexing-agent enrichment prompt). 0.5 drops the
// boilerplate/filler tier while keeping substantive chunks.
export const DOC_FACT_IMPORTANCE_THRESHOLD = 0.5
// An unset importance (enrichment 429 fallback leaves it undefined) is treated
// as this default so a degraded free-tier LLM never silently drops every fact.
export const DOC_FACT_DEFAULT_IMPORTANCE = 0.5
// Backstop so a pathological document can't mint hundreds of facts in one pass.
export const DOC_FACT_PER_DOC_CAP = 50

/** sha256 of the trimmed chunk text — the per-chunk dedup key. */
export function docChunkContentHash(text: string): string {
  return computeContentHash(text.trim())
}

export function selectSalientChunks(
  chunks: DocChunkForIndex[],
  alreadyIndexed: Set<string>,
  opts: SalienceOptions = {}
): SalienceResult {
  const threshold = opts.importanceThreshold ?? DOC_FACT_IMPORTANCE_THRESHOLD
  const cap = opts.perDocCap ?? DOC_FACT_PER_DOC_CAP

  let droppedLowSalience = 0
  let droppedDuplicate = 0
  const batchHashes = new Set<string>()
  const survivors: SelectedDocChunk[] = []

  for (const chunk of chunks) {
    const importance = chunk.importance ?? DOC_FACT_DEFAULT_IMPORTANCE
    if (importance < threshold) {
      droppedLowSalience++
      continue
    }
    const contentHash = docChunkContentHash(chunk.text)
    if (alreadyIndexed.has(contentHash) || batchHashes.has(contentHash)) {
      droppedDuplicate++
      continue
    }
    batchHashes.add(contentHash)
    survivors.push({ chunk, contentHash })
  }

  // Per-doc cap: keep the most-important survivors, but emit them in their
  // original chunk order so downstream sectioning stays coherent.
  if (survivors.length <= cap) {
    return { selected: survivors, droppedLowSalience, droppedDuplicate, droppedOverCap: 0 }
  }
  const kept = survivors
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ia = a.s.chunk.importance ?? DOC_FACT_DEFAULT_IMPORTANCE
      const ib = b.s.chunk.importance ?? DOC_FACT_DEFAULT_IMPORTANCE
      if (ib !== ia) return ib - ia // higher importance first
      return a.i - b.i // stable: earlier chunk wins ties
    })
    .slice(0, cap)
    .sort((a, b) => a.i - b.i) // restore original order for the kept set
    .map((r) => r.s)

  return {
    selected: kept,
    droppedLowSalience,
    droppedDuplicate,
    droppedOverCap: survivors.length - cap,
  }
}
