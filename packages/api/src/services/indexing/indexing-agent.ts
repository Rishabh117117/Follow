/**
 * Indexing Agent
 *
 * AI-powered indexing pipeline that handles:
 * - Semantic chunking (LLM-driven chunk boundaries)
 * - Per-chunk metadata enrichment (summary, topics, entities, importance)
 * - Incremental re-indexing with change detection
 * - Health sweep maintenance
 *
 * Progress + cancel wiring:
 *   Each phase calls `setPhase(job, phase, chunksTotal?)`. Per-chunk work
 *   calls `tickChunk(job, chunkMs)`. At every loop boundary we check
 *   `isCancelled(job)` and bail with a CancelledError which the queue
 *   translates into a `cancelled` status.
 */

import { db } from '../../db/index'
import { documentChunks } from '../../db/schema/knowledge'
import { workspaces } from '../../db/schema/workspaces'
import { rawFiles } from '../../db/schema/raw-files'
import { eq, and } from 'drizzle-orm'
import { getOpenRouterClient } from '../../lib/ai-client'
import { MODEL_TIERS, DEFAULT_MODEL_TIERS, type ModelTier } from '../../config/models'
import { logLLMUsage, calculateCost } from '../../lib/llm-logger'
import { DEV_USER } from '@workspace/shared/constants'
import { generateEmbeddings } from '../embedding'
import { chunkDocument, type ContentChunk } from '../content-chunker'
import { routeFactExtraction } from './fact-routing'
import {
  type IndexJob,
  setPhase,
  tickChunk,
  setMessage,
  isCancelled,
  addJobCost,
  setEstimatedCost,
} from './index-queue'
import { EMBEDDING_MODEL } from '../embedding'
import { createHash } from 'crypto'
import type OpenAI from 'openai'
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions'

// ─── LLM call wrapper: resolves userId + logs usage ───────────────────────

const workspaceUserCache = new Map<string, string>()

async function resolveUserId(workspaceId: string): Promise<string> {
  if (!workspaceId) return DEV_USER.id
  const cached = workspaceUserCache.get(workspaceId)
  if (cached) return cached
  try {
    const [row] = await db
      .select({ ownerId: workspaces.ownerId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
    const userId = row?.ownerId ?? DEV_USER.id
    workspaceUserCache.set(workspaceId, userId)
    return userId
  } catch {
    return DEV_USER.id
  }
}

/**
 * Wraps client.chat.completions.create with automatic llm_usage logging.
 * tier/source are required so the dashboard breakdowns are populated.
 */
async function loggedChat(
  client: OpenAI,
  job: IndexJob,
  tier: ModelTier,
  params: ChatCompletionCreateParamsNonStreaming,
  options?: { signal?: AbortSignal }
) {
  const res = await client.chat.completions.create(params, options)
  try {
    const usage = (
      res as unknown as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
    ).usage
    const inputTokens = Number(usage?.prompt_tokens ?? 0)
    const outputTokens = Number(usage?.completion_tokens ?? 0)
    // Feed live spend back into the job record so the dashboard can warn
    // before another runaway folder spends $10 on enrichment without notice.
    addJobCost(job, calculateCost(params.model, inputTokens, outputTokens))
    const userId = await resolveUserId(job.workspaceId)
    await logLLMUsage({
      userId,
      model: params.model,
      modelTier: tier,
      inputTokens,
      outputTokens,
      source: 'indexing:' + job.type,
    })
  } catch {
    /* never block the pipeline on logging failures */
  }
  return res
}

/**
 * Ballpark USD a job will burn. Computed from the model tiers the pipeline
 * will call and the token ratios we've measured empirically. This is a
 * forward estimate, not a billed number — the actual cost is accumulated
 * via addJobCost() as each call finishes.
 *
 * Model: enrichment does one MICRO_SUMMARY call per 8 chunks, with roughly
 * (chunkChars*8 + 400)/4 input tokens and ~600 output tokens per call.
 * Embeddings bill input only (text-embedding-3-small): chunkChars/4 tokens.
 */
function estimateJobCostUsd(
  chunksTotal: number,
  avgChunkChars: number,
  skipEnrichment: boolean
): number {
  if (chunksTotal <= 0) return 0
  let cost = 0
  if (!skipEnrichment) {
    const batches = Math.ceil(chunksTotal / 8)
    const enrichInput = batches * ((avgChunkChars * 8 + 400) / 4)
    const enrichOutput = batches * 600
    cost += calculateCost(MODEL_TIERS.MICRO_SUMMARY, enrichInput, enrichOutput)
  }
  const embedInput = (chunksTotal * avgChunkChars) / 4
  cost += calculateCost(EMBEDDING_MODEL, embedInput, 0)
  return cost
}

export { estimateJobCostUsd }
void DEFAULT_MODEL_TIERS // retained for type narrowing; silences unused warning

// ─── Constants ────────────────────────────────────────────────────────────

const SMALL_CONTENT_THRESHOLD = 500 // chars — skip LLM chunking for tiny docs
const CHANGE_THRESHOLD = 0.2 // 20% of chunks changed → full re-chunk

// Cap chunks per file. A registry.json with 625 chunks would otherwise hold a
// processing slot for ~17 minutes while ~600 trivially-similar JSON snippets
// re-burn LLM credits. We embed the head and mark the tail truncated; the
// content is still searchable by metadata, just not deeply.
const MAX_CHUNKS_PER_FILE = 100

// File classifications that should skip LLM enrichment. These are structured
// data files where enrichment ("topics", "entities", "summary") doesn't add
// useful signal but consumes one LLM call per 8 chunks.
const STRUCTURED_FILE_PATTERNS = [
  /\.json$/i,
  /\.jsonl$/i,
  /\.ya?ml$/i,
  /\.toml$/i,
  /\.lock$/i,
  /package-lock\./i,
  /yarn\.lock$/i,
  /pnpm-lock\./i,
  /\.csv$/i,
  /\.tsv$/i,
  /\.xml$/i,
  /\.svg$/i,
  /\.min\.(js|css)$/i,
  /\.map$/i, // source maps
  /\.lockfile$/i,
  /\.snap$/i, // jest snapshots
]

function isStructuredData(label: string | undefined, content: string): boolean {
  if (label && STRUCTURED_FILE_PATTERNS.some((re) => re.test(label))) return true
  // Heuristic: if the content is mostly braces/brackets/quotes, treat as structured.
  const sample = content.slice(0, 4000)
  if (!sample.trim()) return false
  const punct = (sample.match(/[{}[\]:",]/g) || []).length
  const punctRatio = punct / sample.length
  return punctRatio > 0.15
}

class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

function bailIfCancelled(job: IndexJob): void {
  if (isCancelled(job)) throw new CancelledError()
}

// ─── Main Entry ───────────────────────────────────────────────────────────

export async function runIndexAgent(job: IndexJob): Promise<void> {
  switch (job.type) {
    case 'full_index':
      await handleFullIndex(job)
      break
    case 'incremental_index':
      await handleIncrementalIndex(job)
      break
    case 'health_sweep':
      await handleHealthSweep(job)
      break
    case 'archivist_run':
    case 'profiler_run': {
      // Pipeline-role jobs (2026-04-29) — dispatched to the role handler.
      // Dynamic import keeps the indexing-agent's hot path free of the
      // pipeline runner module until a role job actually arrives.
      const { dispatchPipelineJob } = await import('../pipeline/runner')
      await dispatchPipelineJob(job)
      break
    }
  }
}

// ─── Full Index ───────────────────────────────────────────────────────────

async function handleFullIndex(job: IndexJob): Promise<void> {
  const content = job.metadata?.['content'] as string | undefined
  if (!content || content.trim().length === 0) {
    console.warn(`[IndexAgent] No content for full_index job ${job.id}`)
    return
  }

  const fileLabel = job.metadata?.['fileName'] as string | undefined
  const structured = isStructuredData(fileLabel, content)

  // ── Phase: chunking ──
  setPhase(job, 'chunking')
  setMessage(
    job,
    structured ? 'Fixed-window chunking (structured data)...' : 'Splitting document into chunks...'
  )
  let chunks: ContentChunk[]

  if (content.length < SMALL_CONTENT_THRESHOLD || structured) {
    // Structured data + small docs: skip the LLM chunker. It's slow and
    // adds no value when the content has no semantic prose to find.
    chunks = chunkDocument(content)
  } else {
    try {
      chunks = await semanticChunk(content, job)
    } catch (error) {
      if (error instanceof CancelledError) throw error
      console.warn(
        '[IndexAgent] LLM chunking failed, falling back to fixed:',
        (error as Error).message
      )
      chunks = chunkDocument(content)
    }
  }

  if (chunks.length === 0) return
  bailIfCancelled(job)

  // E1: Cap chunks per file. Mark the dropped tail in metadata so it's
  // visible downstream that some content was omitted from deep indexing.
  let truncated = false
  if (chunks.length > MAX_CHUNKS_PER_FILE) {
    truncated = true
    const droppedCount = chunks.length - MAX_CHUNKS_PER_FILE
    chunks = chunks.slice(0, MAX_CHUNKS_PER_FILE)
    setMessage(
      job,
      `Truncated ${droppedCount} chunks past the ${MAX_CHUNKS_PER_FILE}-chunk cap (${fileLabel ?? job.sourceId})`
    )
    console.info(
      `[IndexAgent] ${fileLabel ?? job.sourceId}: capped at ${MAX_CHUNKS_PER_FILE} chunks (dropped ${droppedCount})`
    )
  }

  // ── Phase: enriching ──
  setPhase(job, 'enriching', chunks.length)
  // Forward spend estimate, surfaced on the dashboard so the user can stop
  // a folder before the bill climbs (the original $10 incident).
  const avgChunkChars =
    chunks.length > 0
      ? Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length)
      : 0
  setEstimatedCost(job, estimateJobCostUsd(chunks.length, avgChunkChars, structured))
  let enriched: EnrichedChunk[]
  if (structured) {
    // E2: Structured data — skip LLM enrichment. The chunks are stored as-is
    // with empty metadata; embedding still works for keyword/vector lookup.
    setMessage(job, `Skipping enrichment for structured data (${chunks.length} chunks)`)
    enriched = chunks.map((c) => ({
      text: c.text,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      sectionTitle: c.metadata.sectionTitle,
    }))
    // Tick chunks fast so progress reflects "phase complete"
    for (let k = 0; k < chunks.length; k++) tickChunk(job, 0)
  } else {
    setMessage(job, `Enriching ${chunks.length} chunks...`)
    enriched = await enrichChunks(chunks, job)
  }
  bailIfCancelled(job)

  // ── Phase: embedding ──
  setPhase(job, 'embedding', enriched.length)
  setMessage(job, `Generating embeddings for ${enriched.length} chunks...`)
  const texts = enriched.map((c) => c.text)
  let embeddings: number[][] = []
  try {
    // Embed in small batches so we can report progress and honour cancellation
    const BATCH = 8
    for (let i = 0; i < texts.length; i += BATCH) {
      bailIfCancelled(job)
      const batch = texts.slice(i, i + BATCH)
      const t0 = Date.now()
      const batchEmb = await generateEmbeddings(batch)
      embeddings.push(...batchEmb)
      // Embedding is input-only billing. Estimate tokens = chars / 4.
      const batchTokens = batch.reduce((s, t) => s + Math.ceil(t.length / 4), 0)
      addJobCost(job, calculateCost(EMBEDDING_MODEL, batchTokens, 0))
      const perChunk = (Date.now() - t0) / Math.max(batch.length, 1)
      for (let k = 0; k < batch.length; k++) tickChunk(job, perChunk)
    }
  } catch (error) {
    if (error instanceof CancelledError) throw error
    console.error('[IndexAgent] Embedding generation failed:', (error as Error).message)
    embeddings = texts.map(() => [])
  }
  bailIfCancelled(job)

  // ── Phase: storing ──
  setPhase(job, 'storing', enriched.length)
  setMessage(job, 'Writing chunks to database...')

  await db
    .delete(documentChunks)
    .where(
      and(eq(documentChunks.sourceType, job.sourceType), eq(documentChunks.sourceId, job.sourceId))
    )

  for (let i = 0; i < enriched.length; i++) {
    bailIfCancelled(job)
    const chunk = enriched[i]!
    const embedding = embeddings[i]
    const t0 = Date.now()
    await db.insert(documentChunks).values({
      workspaceId: job.workspaceId,
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      chunkIndex: i,
      content: chunk.text,
      embedding: embedding && embedding.length > 0 ? embedding : null,
      summary: chunk.summary ?? null,
      topics: chunk.topics ?? null,
      entities: chunk.entities ?? null,
      importance: chunk.importance ?? 0.5,
      contentHash: hashContent(chunk.text),
      lastAgentRunAt: new Date(),
      metadata: {
        sectionTitle: chunk.sectionTitle,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        ...(structured ? { structured: true } : {}),
        ...(truncated ? { truncatedTail: true, chunkCap: MAX_CHUNKS_PER_FILE } : {}),
      },
    })
    tickChunk(job, Date.now() - t0)
  }

  console.info(
    `[IndexAgent] Full indexed ${enriched.length} chunks for ${job.sourceType}:${job.sourceId}` +
      (structured ? ' (structured, no enrichment)' : '') +
      (truncated ? ` (truncated to ${MAX_CHUNKS_PER_FILE})` : '')
  )

  // ── Post-index: bridge chunks → semantic index records (facts) ──
  // chat_artifact raw_files → chat facts; native uploaded documents
  // ('upload' | 'local') → doc facts (DOC-FACTS-B0). Both route their enriched
  // chunks into index_records / episodes / semantic_links so the knowledge-graph
  // layer has something to query. Non-fatal: chunk writes are the primary
  // deliverable.
  try {
    const [raw] = await db
      .select({
        id: rawFiles.id,
        sourceType: rawFiles.sourceType,
        sourceRef: rawFiles.sourceRef,
        userId: rawFiles.userId,
      })
      .from(rawFiles)
      .where(eq(rawFiles.id, job.sourceId))
      .limit(1)

    const route = routeFactExtraction(raw?.sourceType)
    if (route === 'chat' && raw?.sourceRef) {
      const { extractAndIndexChatFacts } = await import('../semantic-index/chat-fact-extractor')
      const result = await extractAndIndexChatFacts({
        conversationId: raw.sourceRef,
        workspaceId: job.workspaceId,
        userId: raw.userId,
        chunks: enriched.map((c, i) => ({
          chunkIndex: i,
          text: c.text,
          summary: c.summary ?? null,
          topics: c.topics ?? null,
          importance: c.importance ?? null,
          sectionTitle: c.sectionTitle ?? null,
        })),
      })
      if (result) {
        console.info(
          `[IndexAgent] Extracted ${result.factsIndexed} chat facts for conversation ${raw.sourceRef}`
        )
      }
    } else if (route === 'doc' && raw) {
      // DOC-FACTS-B0: native uploaded documents become version-stamped,
      // salience-gated facts. The raw_files.id is the source file id; entities
      // are carried through (the chat path drops them). Drive ('gws') is a
      // separate, later sprint and intentionally not routed here.
      const { extractAndIndexDocFacts } = await import('../semantic-index/doc-fact-extractor')
      const result = await extractAndIndexDocFacts({
        fileId: raw.id,
        workspaceId: job.workspaceId,
        userId: raw.userId,
        chunks: enriched.map((c, i) => ({
          chunkIndex: i,
          text: c.text,
          summary: c.summary ?? null,
          topics: c.topics ?? null,
          importance: c.importance ?? null,
          sectionTitle: c.sectionTitle ?? null,
          entities: c.entities ?? null,
        })),
      })
      if (result) {
        console.info(
          `[IndexAgent] Extracted ${result.factsIndexed} doc facts for file ${raw.id} ` +
            `(dropped ${result.droppedLowSalience} low-salience, ` +
            `${result.droppedDuplicate} duplicate, ${result.droppedOverCap} over-cap)`
        )
      }
    }
  } catch (err) {
    console.warn('[IndexAgent] Fact extraction failed (non-fatal):', (err as Error).message)
  }
}

// ─── Incremental Index ────────────────────────────────────────────────────

async function handleIncrementalIndex(job: IndexJob): Promise<void> {
  const content = job.metadata?.['content'] as string | undefined
  if (!content) {
    console.warn(`[IndexAgent] No content for incremental_index job ${job.id}`)
    return
  }

  setPhase(job, 'chunking')
  const existing = await db
    .select()
    .from(documentChunks)
    .where(
      and(eq(documentChunks.sourceType, job.sourceType), eq(documentChunks.sourceId, job.sourceId))
    )

  if (existing.length === 0) {
    job.type = 'full_index'
    await handleFullIndex(job)
    return
  }

  const newChunks = chunkDocument(content)
  let changedCount = 0
  for (const newChunk of newChunks) {
    const newHash = hashContent(newChunk.text)
    const matchingOld = existing.find(
      (e) => e.chunkIndex === newChunk.index && e.contentHash === newHash
    )
    if (!matchingOld) changedCount++
  }

  const changeRatio = changedCount / Math.max(newChunks.length, existing.length)
  if (changeRatio > CHANGE_THRESHOLD) {
    job.type = 'full_index'
    await handleFullIndex(job)
    return
  }

  // Minor change — only update changed chunks
  const changed = newChunks.filter((newChunk) => {
    const newHash = hashContent(newChunk.text)
    return !existing.find((e) => e.chunkIndex === newChunk.index && e.contentHash === newHash)
  })

  setPhase(job, 'embedding', changed.length)
  for (const newChunk of changed) {
    bailIfCancelled(job)
    const t0 = Date.now()
    const newHash = hashContent(newChunk.text)
    let embedding: number[] = []
    try {
      const [emb] = await generateEmbeddings([newChunk.text])
      if (emb) embedding = emb
      addJobCost(job, calculateCost(EMBEDDING_MODEL, Math.ceil(newChunk.text.length / 4), 0))
    } catch {
      /* swallowed: embedding failure is non-fatal — chunk still indexes with empty vector */
    }

    const existingChunk = existing.find((e) => e.chunkIndex === newChunk.index)
    if (existingChunk) {
      await db
        .update(documentChunks)
        .set({
          content: newChunk.text,
          embedding: embedding.length > 0 ? embedding : null,
          contentHash: newHash,
          updatedAt: new Date(),
          metadata: {
            sectionTitle: newChunk.metadata.sectionTitle,
            startOffset: newChunk.startOffset,
            endOffset: newChunk.endOffset,
          },
        })
        .where(eq(documentChunks.id, existingChunk.id))
    } else {
      await db.insert(documentChunks).values({
        workspaceId: job.workspaceId,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        chunkIndex: newChunk.index,
        content: newChunk.text,
        embedding: embedding.length > 0 ? embedding : null,
        contentHash: newHash,
        lastAgentRunAt: new Date(),
        metadata: {
          sectionTitle: newChunk.metadata.sectionTitle,
          startOffset: newChunk.startOffset,
          endOffset: newChunk.endOffset,
        },
      })
    }
    tickChunk(job, Date.now() - t0)
  }

  // Remove orphaned chunks
  const newIndices = new Set(newChunks.map((c) => c.index))
  for (const old of existing) {
    if (!newIndices.has(old.chunkIndex)) {
      await db.delete(documentChunks).where(eq(documentChunks.id, old.id))
    }
  }

  console.info(
    `[IndexAgent] Incremental indexed ${changedCount} changed chunks for ${job.sourceType}:${job.sourceId}`
  )
}

// ─── Health Sweep ─────────────────────────────────────────────────────────

async function handleHealthSweep(job: IndexJob): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  void cutoff
  const oldChunks = await db
    .select({ id: documentChunks.id, importance: documentChunks.importance })
    .from(documentChunks)
    .where(eq(documentChunks.workspaceId, job.workspaceId))

  let decayCount = 0
  for (const chunk of oldChunks) {
    bailIfCancelled(job)
    if (chunk.importance && chunk.importance > 0.1) {
      await db
        .update(documentChunks)
        .set({ importance: chunk.importance * 0.9 })
        .where(eq(documentChunks.id, chunk.id))
      decayCount++
    }
  }

  console.info(`[IndexAgent] Health sweep: decayed ${decayCount} chunk importance scores`)
}

// ─── LLM-Driven Semantic Chunking ─────────────────────────────────────────

async function semanticChunk(content: string, job: IndexJob): Promise<ContentChunk[]> {
  const client = getOpenRouterClient()
  const response = await loggedChat(
    client,
    job,
    'MICRO_SUMMARY',
    {
      model: MODEL_TIERS.MICRO_SUMMARY,
      messages: [
        {
          role: 'system',
          content: `Split the document into semantically meaningful chunks. Each chunk should cover one coherent topic or argument.
Return a JSON array of objects: [{ "start": <char_offset>, "end": <char_offset>, "title": "<section_topic>" }]
Aim for chunks of 300-800 words each. Prefer splitting at paragraph or section boundaries.`,
        },
        { role: 'user', content: content.slice(0, 20000) },
      ],
      temperature: 0.1,
      max_tokens: 3000,
    },
    { signal: job.abortSignal }
  )
  bailIfCancelled(job)

  const text = response.choices[0]?.message?.content ?? '[]'
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('No valid JSON array in LLM response')

  const boundaries = JSON.parse(jsonMatch[0]) as Array<{
    start: number
    end: number
    title: string
  }>

  return boundaries.map((b, i) => ({
    text: content.slice(b.start, b.end),
    index: i,
    startOffset: b.start,
    endOffset: b.end,
    metadata: { sectionTitle: b.title },
  }))
}

// ─── Chunk Enrichment ─────────────────────────────────────────────────────

interface EnrichedChunk {
  text: string
  startOffset: number
  endOffset: number
  sectionTitle?: string
  summary?: string
  topics?: string[]
  entities?: {
    people?: string[]
    decisions?: string[]
    dates?: string[]
    actionItems?: string[]
  }
  importance?: number
}

async function enrichChunks(chunks: ContentChunk[], job: IndexJob): Promise<EnrichedChunk[]> {
  if (chunks.length === 0) return []

  const client = getOpenRouterClient()

  // Batch enrichment — 8 chunks per LLM call keeps latency predictable and
  // lets us tick progress more frequently than one-call-for-all.
  const BATCH = 8
  const results: EnrichedChunk[] = new Array(chunks.length)

  for (let start = 0; start < chunks.length; start += BATCH) {
    bailIfCancelled(job)
    const end = Math.min(start + BATCH, chunks.length)
    const batch = chunks.slice(start, end)
    const t0 = Date.now()

    const chunkDescriptions = batch
      .map((c, i) => `[Chunk ${i}]: ${c.text.slice(0, 500)}`)
      .join('\n\n')

    try {
      const response = await loggedChat(
        client,
        job,
        'MICRO_SUMMARY',
        {
          model: MODEL_TIERS.MICRO_SUMMARY,
          messages: [
            {
              role: 'system',
              content: `For each chunk, extract metadata. Return a JSON array with one object per chunk:
[{
  "summary": "one-sentence description",
  "topics": ["tag1", "tag2"],
  "entities": { "people": [], "decisions": [], "dates": [], "actionItems": [] },
  "importance": 0.0-1.0
}]
importance: 1.0 = key decision/conclusion, 0.1 = boilerplate/filler. Be concise.`,
            },
            { role: 'user', content: chunkDescriptions },
          ],
          temperature: 0.1,
          max_tokens: 1500,
        },
        { signal: job.abortSignal }
      )

      const text = response.choices[0]?.message?.content ?? '[]'
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      const enrichments = jsonMatch
        ? (JSON.parse(jsonMatch[0]) as Array<{
            summary?: string
            topics?: string[]
            entities?: EnrichedChunk['entities']
            importance?: number
          }>)
        : []

      for (let k = 0; k < batch.length; k++) {
        const chunk = batch[k]!
        const llmTopics = enrichments[k]?.topics
        results[start + k] = {
          text: chunk.text,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          sectionTitle: chunk.metadata.sectionTitle,
          summary: enrichments[k]?.summary,
          topics:
            llmTopics && llmTopics.length > 0
              ? llmTopics
              : extractKeywordTopics(chunk.text, chunk.metadata.sectionTitle),
          entities: enrichments[k]?.entities,
          importance: enrichments[k]?.importance ?? 0.5,
        }
      }
    } catch (error) {
      if (error instanceof CancelledError) throw error
      // The LLM call (typically Gemma 4 free) routinely 429s under load.
      // Topics are load-bearing for `directory_query` matching, so derive
      // them deterministically from the chunk text rather than leaving
      // null. Summary/entities/importance stay unset — those fields aren't
      // matched on, only displayed.
      console.warn(
        '[IndexAgent] Batch enrichment failed, using keyword fallback:',
        (error as Error).message
      )
      for (let k = 0; k < batch.length; k++) {
        const chunk = batch[k]!
        results[start + k] = {
          text: chunk.text,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          sectionTitle: chunk.metadata.sectionTitle,
          topics: extractKeywordTopics(chunk.text, chunk.metadata.sectionTitle),
        }
      }
    }

    const perChunk = (Date.now() - t0) / Math.max(batch.length, 1)
    for (let k = 0; k < batch.length; k++) tickChunk(job, perChunk)
  }

  return results
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

const KEYWORD_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'with',
  'this',
  'have',
  'from',
  'your',
  'will',
  'they',
  'what',
  'about',
  'their',
  'them',
  'then',
  'than',
  'these',
  'those',
  'there',
  'here',
  'also',
  'some',
  'more',
  'most',
  'very',
  'just',
  'when',
  'which',
  'because',
  'into',
  'over',
  'between',
  'through',
  'should',
  'could',
  'would',
  'still',
  'after',
  'before',
  'where',
  'while',
  'been',
  'being',
  'were',
  'was',
  'are',
  'can',
  'its',
  'our',
  'all',
  'any',
  'one',
  'two',
  'not',
  'but',
  'use',
  'used',
  'using',
  'like',
  'make',
  'made',
  'get',
  'got',
  'run',
  'okay',
  'yeah',
  'yes',
  'user',
  'assistant',
  'chunk',
  'section',
  'message',
  'response',
  'prompt',
])

function extractKeywordTopics(text: string, sectionTitle?: string | null): string[] {
  // Deterministic fallback when LLM enrichment is unavailable. Picks the
  // most-frequent multi-char non-stopword tokens. Used by `directory_query`
  // for topic matching, so we only need *plausible* tags — not the model's
  // best take.
  const counts = new Map<string, number>()
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []
  for (const t of tokens) {
    if (KEYWORD_STOPWORDS.has(t)) continue
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const top = Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word)
  if (sectionTitle && sectionTitle.length <= 60) {
    const slug = sectionTitle.toLowerCase().trim()
    if (slug && !top.includes(slug)) top.unshift(slug)
  }
  return top.slice(0, 4)
}
