/**
 * Chat Fact Extractor
 *
 * Bridges the file-indexing pipeline (document_chunks + embeddings) into the
 * semantic-index pipeline (index_records) for chat_artifact raw files. The
 * realtime capture pipeline writes index_records via indexDistilledEvents; a
 * saved chat never touches that path because it has no thread_events from
 * live capture. This extractor fabricates the minimum scaffolding required
 * — a thread + session + one thread_event per chunk — then calls
 * indexDistilledEvents so the existing dedup, embedding, episode, and link
 * logic all kick in.
 *
 * Called at the end of handleFullIndex when the raw_file's source_type is
 * 'chat_artifact'. Failures are non-fatal: the chunk writes are the primary
 * deliverable, semantic-index enrichment is best-effort.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/index'
import { threads, threadEvents, threadSessions } from '../../db/schema/threads'
import { chatConversations } from '../../db/schema/chat'
import { indexDistilledEvents } from './indexer'

export interface ChatChunkForIndex {
  chunkIndex: number
  text: string
  summary?: string | null
  topics?: string[] | null
  importance?: number | null
  sectionTitle?: string | null
}

function magnitudeFromImportance(importance: number | null | undefined): 'low' | 'medium' | 'high' {
  if (importance == null) return 'low'
  if (importance >= 0.75) return 'high'
  if (importance >= 0.5) return 'medium'
  return 'low'
}

/**
 * FACET-FIX-1: recover the user's question from a chunk as genuine WHY-signal
 * for the causal facet. The chat transcript is serialized as
 * "[user] …\n\n[assistant] …" (save-conversation `syncConversationWrapper`), so
 * a chunk usually contains at least one "[user]" turn. Returns null when the
 * window has no user turn (then causal stays empty → NULL, which is correct).
 */
export function extractQuestionFromChunk(text: string): string | null {
  const m = text.match(/\[user\]\s*([\s\S]*?)(?:\n\n\[|$)/i)
  const q = m?.[1]?.trim()
  if (!q) return null
  return q.replace(/\s+/g, ' ').slice(0, 300)
}

function labelFromChunk(chunk: ChatChunkForIndex): string {
  const summary = (chunk.summary ?? '').trim()
  if (summary.length > 0) return summary.slice(0, 240)
  // Fall back to a short slice of the raw text so the index row has a
  // searchable label even when enrichment produced no summary.
  return chunk.text.trim().replace(/\s+/g, ' ').slice(0, 200)
}

/**
 * Find-or-create the canonical 'ai' thread that represents a saved
 * conversation. One thread per conversationId — re-running the extractor
 * for a re-indexed chat reuses the same thread and lets indexDistilledEvents
 * dedup against the existing index_records.
 */
async function ensureConversationThread(params: {
  conversationId: string
  workspaceId: string
  userId: string
  conversationTitle: string
}): Promise<string> {
  // Postgres JSONB → text cast lets us filter by a nested key without needing
  // a schema change. The volume is small (one row per chat) so a seq scan is
  // fine; the threads_workspace_type_status_idx narrows it by workspace+type
  // first.
  const existing = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.workspaceId, params.workspaceId),
        eq(threads.type, 'ai'),
        sql`${threads.metadata}->>'conversationId' = ${params.conversationId}`
      )
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [row] = await db
    .insert(threads)
    .values({
      workspaceId: params.workspaceId,
      ownerId: params.userId,
      type: 'ai',
      name: `Chat: ${params.conversationTitle.slice(0, 120)}`,
      metadata: {
        conversationId: params.conversationId,
        fileId: params.conversationId,
        fileName: `conversation-${params.conversationId}.txt`,
        importSource: 'chat-fact-extractor',
      },
    })
    .returning({ id: threads.id })
  if (!row) throw new Error('Failed to create thread for conversation')
  return row.id
}

export async function extractAndIndexChatFacts(params: {
  conversationId: string
  workspaceId: string
  userId: string
  chunks: ChatChunkForIndex[]
}): Promise<{ factsIndexed: number; threadId: string; sessionId: string } | null> {
  if (params.chunks.length === 0) return null

  // Resolve a display title for the thread + embedding text composition.
  const [convo] = await db
    .select({ title: chatConversations.title })
    .from(chatConversations)
    .where(eq(chatConversations.id, params.conversationId))
    .limit(1)
  const conversationTitle = convo?.title ?? 'Untitled conversation'

  const threadId = await ensureConversationThread({
    conversationId: params.conversationId,
    workspaceId: params.workspaceId,
    userId: params.userId,
    conversationTitle,
  })

  // A fresh session per indexing pass. indexDistilledEvents filters
  // thread_events by sessionId, so this scopes the lookup to just the
  // events we're about to insert.
  const [session] = await db
    .insert(threadSessions)
    .values({
      threadId,
      status: 'complete',
      rawSignalCount: params.chunks.length,
      distilledEventCount: params.chunks.length,
      lastProcessedAt: new Date(),
    })
    .returning({ id: threadSessions.id })
  if (!session) throw new Error('Failed to create thread session')
  const sessionId = session.id

  // Insert one thread_event per chunk. Label is what the semantic indexer
  // will match back to when it fetches recentEvents.
  const eventsToInsert = params.chunks.map((c) => {
    const chatQuestion = extractQuestionFromChunk(c.text)
    return {
      threadId,
      sessionId,
      label: labelFromChunk(c),
      type: 'ai_interaction' as const,
      magnitude: magnitudeFromImportance(c.importance),
      keyChange: (c.importance ?? 0) >= 0.7,
      // FACET-FIX-1: topics no longer masquerade as causal `contextNotes`
      // ("Topics: …" is WHAT, not WHY — it was the content↔causal overlap).
      // Topics still flow via metadata.topics (below) + the main embedding.
      contextNotes: null,
      distilledFrom: ['chat_artifact'],
      metadata: {
        conversationId: params.conversationId,
        chunkIndex: c.chunkIndex,
        sectionTitle: c.sectionTitle ?? null,
        // Give buildAITemplate + the content facet the substantive text so the
        // embeddings carry the actual conversation content, not just metadata.
        // Cap at ~4KB — composeEmbeddingText clips to 8000 after joining.
        chunkContent: c.text.slice(0, 4000),
        topics: c.topics ?? null,
        // FACET-FIX-1: real WHY-signal for the causal facet when recoverable.
        ...(chatQuestion ? { chatQuestion } : {}),
      },
    }
  })
  await db.insert(threadEvents).values(eventsToInsert)

  // Hand off to the existing indexer so facet embeddings, episode
  // assignment, and semantic links all run the same way they do for the
  // realtime capture pipeline.
  const distilledEvents = eventsToInsert.map((e) => ({
    label: e.label,
    type: e.type,
    magnitude: e.magnitude,
    keyChange: e.keyChange,
    contextNotes: e.contextNotes,
    distilledFrom: e.distilledFrom,
    metadata: e.metadata,
  }))

  await indexDistilledEvents(distilledEvents, threadId, sessionId, params.workspaceId)

  return { factsIndexed: distilledEvents.length, threadId, sessionId }
}
