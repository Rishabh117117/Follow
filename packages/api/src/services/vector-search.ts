/**
 * Vector Search Service
 *
 * Performs semantic similarity search over document chunks using pgvector.
 * Supports scoped search: workspace-wide, project-scoped, or single document.
 */

import { db } from '../db/index'
import { documentChunks } from '../db/schema/knowledge'
import { spaceDocuments } from '../db/schema/spaces'
import { externalDocuments } from '../db/schema/external-documents'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { generateEmbedding, hasEmbeddingSupport } from './embedding'

// ─── Types ────────────────────────────────────────────────────────────────

export interface SearchResult {
  chunkId: string
  sourceType: string
  sourceId: string
  content: string
  summary: string | null
  topics: string[] | null
  similarity: number
  importance: number | null
  metadata: Record<string, unknown>
}

export interface SearchScope {
  type: 'workspace' | 'project' | 'document'
  id: string
}

export interface VectorSearchParams {
  query: string
  workspaceId: string
  scope?: SearchScope
  sourceTypes?: string[]
  limit?: number
  threshold?: number
}

// ─── Main Search ──────────────────────────────────────────────────────────

/**
 * Perform semantic vector search over document chunks.
 *
 * Uses pgvector's cosine distance operator (<=>).
 * Falls back gracefully if embeddings aren't available.
 */
export async function vectorSearch(params: VectorSearchParams): Promise<SearchResult[]> {
  const {
    query,
    workspaceId,
    scope,
    sourceTypes,
    limit = 10,
    threshold = 0.7,
  } = params

  if (!hasEmbeddingSupport()) {
    console.warn('[VectorSearch] No embedding support — skipping vector search')
    return []
  }

  // Generate query embedding
  let queryEmbedding: number[]
  try {
    queryEmbedding = await generateEmbedding(query)
  } catch (error) {
    console.error('[VectorSearch] Failed to generate query embedding:', error)
    return []
  }

  // Build source ID filter for project scope
  let projectSourceIds: string[] | null = null
  if (scope?.type === 'project') {
    const docs = await db
      .select()
      .from(spaceDocuments)
      .where(eq(spaceDocuments.spaceId, scope.id))

    projectSourceIds = []
    for (const d of docs) {
      if (d.fileId) projectSourceIds.push(d.fileId)
      if (d.externalDocumentId) projectSourceIds.push(d.externalDocumentId)
    }

    if (projectSourceIds.length === 0) return []
  }

  // Build the query
  const embeddingStr = `[${queryEmbedding.join(',')}]`

  // Use raw SQL for pgvector cosine distance
  // PGlite uses REAL[] so we can't use <=> operator — fall back to manual cosine similarity
  const results = await db
    .select({
      id: documentChunks.id,
      sourceType: documentChunks.sourceType,
      sourceId: documentChunks.sourceId,
      content: documentChunks.content,
      summary: documentChunks.summary,
      topics: documentChunks.topics,
      importance: documentChunks.importance,
      metadata: documentChunks.metadata,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.workspaceId, workspaceId),
        // Source type filter
        sourceTypes && sourceTypes.length > 0
          ? inArray(documentChunks.sourceType, sourceTypes)
          : undefined,
        // Scope filters
        scope?.type === 'document'
          ? eq(documentChunks.sourceId, scope.id)
          : undefined,
        projectSourceIds
          ? inArray(documentChunks.sourceId, projectSourceIds)
          : undefined,
        // Only search chunks that have embeddings
        sql`${documentChunks.embedding} IS NOT NULL`
      )
    )
    .limit(limit * 3) // Over-fetch for post-filter scoring

  if (results.length === 0) return []

  // Compute cosine similarity in JS (PGlite doesn't support pgvector operators)
  const scored: SearchResult[] = []

  for (const row of results) {
    // Read embedding from DB — stored as REAL[]
    const chunkEmbeddingResult = await db
      .select({ embedding: documentChunks.embedding })
      .from(documentChunks)
      .where(eq(documentChunks.id, row.id))
      .limit(1)

    const chunkEmbedding = chunkEmbeddingResult[0]?.embedding as number[] | null
    if (!chunkEmbedding || chunkEmbedding.length === 0) continue

    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding)
    if (similarity < threshold) continue

    scored.push({
      chunkId: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      content: row.content,
      summary: row.summary,
      topics: row.topics,
      similarity,
      importance: row.importance,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    })
  }

  // Sort by similarity descending and take top results
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, limit)
}

// ─── Cosine Similarity ───────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}
