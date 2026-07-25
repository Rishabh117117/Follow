import { Hono } from 'hono'
import { eq, desc, and, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { knowledgeDocs } from '../db/schema/knowledge'
import { authMiddleware } from '../middleware/auth'
import { vectorSearch } from '../services/vector-search'

// KNOWLEDGE-EDGES-DROP-1 (2026-04-22): knowledge_edges table dropped.
// The `/graph` endpoint now returns empty nodes + edges; every other
// endpoint on this route (`/search`, `/docs`, `/docs/:id`, `/stats`,
// `/search/semantic`) is unaffected because they read `knowledgeDocs`
// (distinct from `knowledge_edges`). The /knowledge page in the web
// app continues to work for the doc-list view; the graph view renders
// empty until a future relationship-scan rebuild populates it.

const app = new Hono()

app.use('*', authMiddleware)

// ─── Search knowledge docs ───────────────────────────────────────────
app.post('/search', async (c) => {
  const body = await c.req.json<{
    query: string
    workspaceId: string
    docTypes?: string[]
    limit?: number
  }>()

  if (!body.query || !body.workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'query and workspaceId required' } },
      400
    )
  }

  const limit = Math.min(body.limit ?? 5, 20)

  // For now, do keyword-based search on content (pgvector search added when embeddings exist)
  const results = await db
    .select()
    .from(knowledgeDocs)
    .where(
      and(
        eq(knowledgeDocs.workspaceId, body.workspaceId),
        body.docTypes && body.docTypes.length > 0
          ? sql`${knowledgeDocs.docType} = ANY(${body.docTypes})`
          : undefined
      )
    )
    .orderBy(desc(knowledgeDocs.lastUpdated))
    .limit(limit)

  return c.json({
    data: {
      results: results.map((r) => ({
        id: r.id,
        docType: r.docType,
        content: r.content,
        score: 1.0,
        updatedAt: r.lastUpdated,
      })),
    },
    error: null,
  })
})

// ─── List knowledge docs ─────────────────────────────────────────────
app.get('/docs', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  const docType = c.req.query('docType')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 100)

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  const results = await db
    .select()
    .from(knowledgeDocs)
    .where(
      and(
        eq(knowledgeDocs.workspaceId, workspaceId),
        docType ? eq(knowledgeDocs.docType, docType) : undefined
      )
    )
    .orderBy(desc(knowledgeDocs.lastUpdated))
    .limit(limit)

  return c.json({ data: results, error: null })
})

// ─── Get knowledge doc by ID ─────────────────────────────────────────
app.get('/docs/:id', async (c) => {
  const [doc] = await db
    .select()
    .from(knowledgeDocs)
    .where(eq(knowledgeDocs.id, c.req.param('id')))

  if (!doc) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Doc not found' } }, 404)
  }

  return c.json({ data: doc, error: null })
})

// ─── Knowledge graph: get subgraph ───────────────────────────────────
app.get('/graph', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }
  // KNOWLEDGE-EDGES-DROP-1: knowledge_edges table dropped. Returning an
  // empty graph preserves the endpoint shape so the /knowledge page can
  // still load without error. When cross-doc relationships come back in
  // a future rebuild, this handler is the site to re-query.
  return c.json({ data: { nodes: [], edges: [] }, error: null })
})

// ─── Stats ───────────────────────────────────────────────────────────
app.get('/stats', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  const docs = await db
    .select()
    .from(knowledgeDocs)
    .where(eq(knowledgeDocs.workspaceId, workspaceId))

  const typeCounts: Record<string, number> = {}
  let lastUpdated: Date | null = null
  for (const doc of docs) {
    typeCounts[doc.docType] = (typeCounts[doc.docType] ?? 0) + 1
    if (!lastUpdated || doc.lastUpdated > lastUpdated) {
      lastUpdated = doc.lastUpdated
    }
  }

  return c.json({
    data: { totalDocs: docs.length, typeCounts, lastUpdated },
    error: null,
  })
})

// ─── Semantic Search (vector) ─────────────────────────────────────────
app.post('/search/semantic', async (c) => {
  const body = await c.req.json<{
    query: string
    workspaceId: string
    scope?: { type: 'workspace' | 'project' | 'document'; id: string }
    sourceTypes?: string[]
    limit?: number
    threshold?: number
  }>()

  if (!body.query || !body.workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'query and workspaceId required' } },
      400
    )
  }

  const results = await vectorSearch({
    query: body.query,
    workspaceId: body.workspaceId,
    scope: body.scope,
    sourceTypes: body.sourceTypes,
    limit: Math.min(body.limit ?? 10, 50),
    threshold: body.threshold ?? 0.7,
  })

  return c.json({ data: { results }, error: null })
})

export const knowledgeRouter = app
