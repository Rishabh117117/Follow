/**
 * Episode Refinement (Sprint IX-1)
 *
 * Background job that runs every 5 minutes to:
 * 1. Close stale open episodes (no new records for 15 minutes)
 * 2. Generate titles for multi-record episodes via LLM
 * 3. Handle episode merging (deferred to IX-2)
 */

import { db } from '../../db/index'
import { eq, and, lt, sql } from 'drizzle-orm'
import { episodes, indexRecords } from '../../db/schema/semantic-index'
import { MODEL_TIERS } from '../../config/models'
import { getOpenRouterClient } from '../../lib/ai-client'

const STALE_MINUTES = 15

/**
 * Refine episodes for a workspace. Called every 5 minutes.
 */
export async function refineEpisodes(workspaceId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000)

  // Find open episodes that haven't been updated recently
  const staleEpisodes = await db
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.workspaceId, workspaceId),
        eq(episodes.status, 'open'),
        lt(episodes.updatedAt, cutoff)
      )
    )

  for (const episode of staleEpisodes) {
    try {
      await closeEpisode(episode)
    } catch (err) {
      console.warn(`[EpisodeRefiner] Failed to close episode ${episode.id}:`, err)
    }
  }
}

/**
 * Close an episode: generate title for multi-record episodes, set status to closed.
 */
async function closeEpisode(episode: typeof episodes.$inferSelect): Promise<void> {
  let title = episode.title
  let summaryText = episode.summaryText

  // Generate title for episodes with multiple records
  if (episode.recordCount > 1 && !episode.title) {
    try {
      const result = await generateEpisodeSummary(episode.id)
      title = result.title
      summaryText = result.summary
    } catch (err) {
      // LLM failure is non-fatal — close with null title
      console.warn(`[EpisodeRefiner] LLM summary failed for episode ${episode.id}:`, err)
    }
  } else if (episode.recordCount === 1 && !episode.title) {
    // Single-record episodes: use the record's label as title
    const [record] = await db
      .select({ text: indexRecords.embeddingText })
      .from(indexRecords)
      .where(eq(indexRecords.episodeId, episode.id))
      .limit(1)

    if (record) {
      // Extract first line as title
      title = record.text.split('\n')[0]?.replace(/^\[.*?\]\s*/, '') ?? null
    }
  }

  await db
    .update(episodes)
    .set({
      status: 'closed',
      title,
      summaryText,
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episode.id))
}

/**
 * Generate a title and summary for an episode using LLM.
 */
async function generateEpisodeSummary(
  episodeId: string
): Promise<{ title: string; summary: string }> {
  // Fetch all records in this episode
  const records = await db
    .select({
      text: indexRecords.embeddingText,
      magnitude: indexRecords.indexMagnitude,
      isKeyChange: indexRecords.isKeyChange,
      threadType: indexRecords.threadType,
      eventTime: indexRecords.eventTime,
    })
    .from(indexRecords)
    .where(eq(indexRecords.episodeId, episodeId))

  if (records.length === 0) {
    return { title: 'Empty episode', summary: '' }
  }

  const eventSummaries = records
    .map((r) => `[${r.threadType}] ${r.text.split('\n')[0] ?? ''} (${r.magnitude}${r.isKeyChange ? ', key' : ''})`)
    .join('\n')

  const client = getOpenRouterClient()
  const response = await client.chat.completions.create({
    model: MODEL_TIERS.INDEX_AGENT,
    messages: [
      {
        role: 'system',
        content:
          'Generate a brief title (max 80 chars) and one-sentence summary for this work episode. Respond in JSON: {"title": "...", "summary": "..."}',
      },
      {
        role: 'user',
        content: `Events in this episode:\n${eventSummaries}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 200,
  })

  const text = response.choices[0]?.message?.content ?? ''

  try {
    // Try to parse JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        title: (parsed.title as string) ?? 'Work episode',
        summary: (parsed.summary as string) ?? '',
      }
    }
  } catch {
    // JSON parse failed, use raw text
  }

  return { title: text.slice(0, 80), summary: text }
}
