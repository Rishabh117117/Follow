/**
 * Thread Event Indexer
 *
 * Embeds thread events directly (no LLM agent needed).
 * Combines label + contextNotes into a single text for embedding.
 */

import { db } from '../../db/index'
import { documentChunks } from '../../db/schema/knowledge'
import { eq, and } from 'drizzle-orm'
import { generateEmbeddings } from '../embedding'
import { createHash } from 'crypto'

interface ThreadEventForIndexing {
  id: string
  threadId: string
  workspaceId: string
  label: string
  contextNotes?: string | null
  type: string
  magnitude: string
}

/**
 * Index a batch of thread events by embedding their text.
 */
export async function indexThreadEvents(
  events: ThreadEventForIndexing[]
): Promise<void> {
  if (events.length === 0) return

  // Build text for each event
  const texts = events.map((e) => {
    const parts = [e.label]
    if (e.contextNotes) parts.push(e.contextNotes)
    return parts.join(' — ')
  })

  // Generate embeddings — but DON'T abort the indexing if it fails. Storing
  // chunks without embeddings still makes them findable via the LIKE-based
  // fallback in queryDocumentChunks, and the indexer can backfill embeddings
  // later. Previously this `return` here was the silent failure mode behind
  // MCP-FIX-2: conversations were never appearing in query_index because a
  // missing OPENAI_API_KEY (or a transient embed error) wiped every chunk.
  let embeddings: number[][] | null = null
  try {
    embeddings = await generateEmbeddings(texts)
  } catch (error) {
    console.warn(
      '[ThreadEventIndexer] Embedding failed; storing chunks without embeddings:',
      (error as Error).message
    )
  }

  // Store as document chunks
  let storedCount = 0
  let skippedCount = 0
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!
    const embedding = embeddings?.[i]
    const text = texts[i]!
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 16)

    // Check if already indexed
    const [existing] = await db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.sourceType, 'thread_event'),
          eq(documentChunks.sourceId, event.id)
        )
      )
      .limit(1)

    if (existing) {
      skippedCount++
      continue
    }

    await db.insert(documentChunks).values({
      workspaceId: event.workspaceId,
      sourceType: 'thread_event',
      sourceId: event.id,
      chunkIndex: 0,
      content: text,
      embedding: embedding && embedding.length > 0 ? embedding : null,
      contentHash: hash,
      importance: event.magnitude === 'high' ? 0.9 : event.magnitude === 'medium' ? 0.6 : 0.3,
      metadata: {
        threadId: event.threadId,
        eventType: event.type,
        magnitude: event.magnitude,
      },
    })
    storedCount++
  }

  const embedTag = embeddings ? 'with embeddings' : 'WITHOUT embeddings (text-only fallback)'
  console.info(
    `[ThreadEventIndexer] Indexed ${storedCount} new + ${skippedCount} duplicate of ${events.length} events ${embedTag}`
  )
}

/**
 * Re-embed thread-event chunks that landed without embeddings (e.g. because
 * the embedding API was unavailable at write time). Returns the count of
 * rows successfully embedded. Use as a one-time backfill or scheduled sweep.
 */
export async function backfillThreadEventEmbeddings(
  workspaceId: string,
  limit = 100
): Promise<number> {
  const { isNull } = await import('drizzle-orm')
  const rows = await db
    .select({
      id: documentChunks.id,
      content: documentChunks.content,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.workspaceId, workspaceId),
        eq(documentChunks.sourceType, 'thread_event'),
        isNull(documentChunks.embedding)
      )
    )
    .limit(limit)

  if (rows.length === 0) return 0

  let embeddings: number[][]
  try {
    embeddings = await generateEmbeddings(rows.map((r) => r.content))
  } catch (err) {
    console.warn('[ThreadEventIndexer] Backfill embedding failed:', (err as Error).message)
    return 0
  }

  let updated = 0
  for (let i = 0; i < rows.length; i++) {
    const embedding = embeddings[i]
    if (!embedding || embedding.length === 0) continue
    await db
      .update(documentChunks)
      .set({ embedding })
      .where(eq(documentChunks.id, rows[i]!.id))
    updated++
  }
  console.info(`[ThreadEventIndexer] Backfilled embeddings for ${updated}/${rows.length} chunks`)
  return updated
}
