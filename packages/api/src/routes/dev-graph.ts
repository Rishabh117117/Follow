/**
 * Dev Graph Routes (2026-04-28)
 *
 * Spreadsheet-style read-only views of the semantic graph for the dev console.
 * Joins users + workspaces/spaces + index_records (nodes) + semantic_links
 * (weighted edges) so the operator can see exactly what got materialized
 * during indexing — per user, per index.
 *
 * Operator/dev-console surface — dumps any workspace's semantic graph (fact
 * content, user names/emails). SECURITY (security-gate-1): now gated behind the
 * dashboard token, matching the other operator endpoints. The dev console sends
 * X-Dashboard-Token via authedFetch(); in production without a token configured
 * it 503s (was previously mounted wide-open despite the "not in production"
 * note).
 */

import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/index'
import { dashboardTokenMiddleware } from '../middleware/dashboard-token'

export const devGraphRouter = new Hono()
devGraphRouter.use('*', dashboardTokenMiddleware)

// GET /summary
// One row per (workspace × user × space) with node + edge counts and last
// activity timestamp. This is the top-level table the dev console renders
// before drilling into a specific index.
devGraphRouter.get('/summary', async (c) => {
  try {
    const rows = await db.execute(sql`
      WITH node_agg AS (
        SELECT
          ir.workspace_id,
          ir.user_id,
          (t.metadata->>'spaceId')::uuid                  AS space_id,
          COUNT(*)::int                                   AS node_count,
          SUM(CASE WHEN ir.is_key_change THEN 1 ELSE 0 END)::int AS key_change_count,
          AVG(ir.engagement_depth)::float                 AS avg_engagement,
          MAX(ir.indexed_at)                              AS last_indexed_at
        FROM index_records ir
        LEFT JOIN threads t ON t.id = ir.thread_id
        WHERE ir.deleted_at IS NULL
        GROUP BY 1, 2, 3
      ),
      edge_agg AS (
        SELECT
          sl.workspace_id,
          ir.user_id,
          COUNT(*)::int                  AS edge_count,
          AVG(sl.similarity)::float      AS avg_similarity,
          SUM(CASE WHEN sl.cross_user THEN 1 ELSE 0 END)::int AS cross_user_edges
        FROM semantic_links sl
        JOIN index_records ir ON ir.id = sl.source_record_id
        WHERE sl.deleted_at IS NULL AND ir.deleted_at IS NULL
        GROUP BY 1, 2
      )
      SELECT
        n.workspace_id,
        n.user_id,
        n.space_id,
        u.name        AS user_name,
        u.email       AS user_email,
        s.name        AS space_name,
        n.node_count,
        n.key_change_count,
        n.avg_engagement,
        n.last_indexed_at,
        COALESCE(e.edge_count, 0)        AS edge_count,
        e.avg_similarity,
        COALESCE(e.cross_user_edges, 0)  AS cross_user_edges
      FROM node_agg n
      LEFT JOIN edge_agg e
        ON e.workspace_id = n.workspace_id AND e.user_id = n.user_id
      LEFT JOIN users u  ON u.id  = n.user_id
      LEFT JOIN spaces s ON s.id  = n.space_id
      ORDER BY n.last_indexed_at DESC NULLS LAST
    `)

    const rowsArray: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])

    const data = rowsArray.map((r) => ({
      workspaceId: r['workspace_id'] ? String(r['workspace_id']) : null,
      userId: r['user_id'] ? String(r['user_id']) : null,
      userName: r['user_name'] ? String(r['user_name']) : '',
      userEmail: r['user_email'] ? String(r['user_email']) : '',
      spaceId: r['space_id'] ? String(r['space_id']) : null,
      spaceName: r['space_name'] ? String(r['space_name']) : 'Personal',
      nodeCount: Number(r['node_count'] ?? 0),
      keyChangeCount: Number(r['key_change_count'] ?? 0),
      avgEngagement: r['avg_engagement'] === null ? null : Number(r['avg_engagement']),
      lastIndexedAt: r['last_indexed_at'] ? String(r['last_indexed_at']) : null,
      edgeCount: Number(r['edge_count'] ?? 0),
      avgSimilarity: r['avg_similarity'] === null ? null : Number(r['avg_similarity']),
      crossUserEdges: Number(r['cross_user_edges'] ?? 0),
    }))

    return c.json({ data, error: null })
  } catch (e: unknown) {
    return c.json(
      {
        data: [],
        error: { code: 'QUERY_FAILED', message: e instanceof Error ? e.message : String(e) },
      },
      500
    )
  }
})

// GET /nodes?userId=&workspaceId=&spaceId=&limit=&offset=
// One row per index_record. Default limit 200 to keep the table snappy.
devGraphRouter.get('/nodes', async (c) => {
  const userId = c.req.query('userId') ?? null
  const workspaceId = c.req.query('workspaceId') ?? null
  const spaceId = c.req.query('spaceId') ?? null
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000)
  const offset = Number(c.req.query('offset') ?? 0)

  try {
    // We build the WHERE in SQL fragments so users with no filter still get a
    // bounded scan via LIMIT/OFFSET.
    const rows = await db.execute(sql`
      SELECT
        ir.id,
        ir.workspace_id,
        ir.thread_id,
        ir.thread_type,
        ir.index_magnitude,
        ir.is_key_change,
        ir.is_ai_involved,
        ir.has_evidence,
        ir.engagement_depth,
        ir.episode_id,
        ir.document_id,
        ir.document_title,
        ir.section_alias,
        ir.user_id,
        u.name  AS user_name,
        u.email AS user_email,
        ir.event_time,
        ir.indexed_at,
        ir.embedding_text,
        ir.source_file_id,
        ir.source_version,
        (t.metadata->>'spaceId') AS space_id,
        s.name AS space_name,
        (SELECT COUNT(*)::int FROM semantic_links WHERE source_record_id = ir.id AND deleted_at IS NULL) AS out_edges,
        (SELECT COUNT(*)::int FROM semantic_links WHERE target_record_id = ir.id AND deleted_at IS NULL) AS in_edges
      FROM index_records ir
      LEFT JOIN users   u ON u.id = ir.user_id
      LEFT JOIN threads t ON t.id = ir.thread_id
      LEFT JOIN spaces  s ON s.id = (t.metadata->>'spaceId')::uuid
      WHERE ir.deleted_at IS NULL
        ${userId ? sql`AND ir.user_id = ${userId}::uuid` : sql``}
        ${workspaceId ? sql`AND ir.workspace_id = ${workspaceId}::uuid` : sql``}
        ${spaceId ? sql`AND (t.metadata->>'spaceId') = ${spaceId}` : sql``}
      ORDER BY ir.indexed_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `)

    const rowsArray: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])

    const data = rowsArray.map((r) => ({
      id: String(r['id']),
      workspaceId: r['workspace_id'] ? String(r['workspace_id']) : null,
      threadId: r['thread_id'] ? String(r['thread_id']) : null,
      threadType: r['thread_type'] ? String(r['thread_type']) : null,
      magnitude: r['index_magnitude'] ? String(r['index_magnitude']) : null,
      isKeyChange: !!r['is_key_change'],
      isAIInvolved: !!r['is_ai_involved'],
      hasEvidence: !!r['has_evidence'],
      engagementDepth: Number(r['engagement_depth'] ?? 0),
      episodeId: r['episode_id'] ? String(r['episode_id']) : null,
      documentId: r['document_id'] ? String(r['document_id']) : null,
      documentTitle: r['document_title'] ? String(r['document_title']) : null,
      sectionAlias: r['section_alias'] ? String(r['section_alias']) : null,
      userId: r['user_id'] ? String(r['user_id']) : null,
      userName: r['user_name'] ? String(r['user_name']) : '',
      userEmail: r['user_email'] ? String(r['user_email']) : '',
      eventTime: r['event_time'] ? String(r['event_time']) : null,
      indexedAt: r['indexed_at'] ? String(r['indexed_at']) : null,
      embeddingText:
        typeof r['embedding_text'] === 'string'
          ? (r['embedding_text'] as string).slice(0, 500)
          : '',
      sourceFileId: r['source_file_id'] ? String(r['source_file_id']) : null,
      sourceVersion: r['source_version'] === null ? null : Number(r['source_version']),
      spaceId: r['space_id'] ? String(r['space_id']) : null,
      spaceName: r['space_name'] ? String(r['space_name']) : 'Personal',
      outEdges: Number(r['out_edges'] ?? 0),
      inEdges: Number(r['in_edges'] ?? 0),
    }))

    return c.json({ data, error: null, limit, offset })
  } catch (e: unknown) {
    return c.json(
      {
        data: [],
        error: { code: 'QUERY_FAILED', message: e instanceof Error ? e.message : String(e) },
      },
      500
    )
  }
})

// GET /edges?userId=&workspaceId=&spaceId=&minSimilarity=&limit=&offset=
// One row per semantic_link with both endpoints expanded. Sorted by weight
// (similarity) DESC so the strongest edges show first.
devGraphRouter.get('/edges', async (c) => {
  const userId = c.req.query('userId') ?? null
  const workspaceId = c.req.query('workspaceId') ?? null
  const spaceId = c.req.query('spaceId') ?? null
  const minSimilarity = Number(c.req.query('minSimilarity') ?? 0)
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000)
  const offset = Number(c.req.query('offset') ?? 0)

  try {
    const rows = await db.execute(sql`
      SELECT
        sl.id,
        sl.workspace_id,
        sl.similarity,
        sl.link_type,
        sl.cross_user,
        sl.reason,
        sl.created_at,
        src.id              AS source_id,
        src.user_id         AS source_user_id,
        su.name             AS source_user_name,
        src.document_title  AS source_doc,
        src.embedding_text  AS source_text,
        src.index_magnitude AS source_magnitude,
        tgt.id              AS target_id,
        tgt.user_id         AS target_user_id,
        tu.name             AS target_user_name,
        tgt.document_title  AS target_doc,
        tgt.embedding_text  AS target_text,
        tgt.index_magnitude AS target_magnitude
      FROM semantic_links sl
      JOIN index_records src ON src.id = sl.source_record_id
      JOIN index_records tgt ON tgt.id = sl.target_record_id
      LEFT JOIN users su   ON su.id = src.user_id
      LEFT JOIN users tu   ON tu.id = tgt.user_id
      LEFT JOIN threads st ON st.id = src.thread_id
      LEFT JOIN threads tt ON tt.id = tgt.thread_id
      WHERE sl.similarity >= ${minSimilarity}
        AND sl.deleted_at IS NULL
        AND src.deleted_at IS NULL
        AND tgt.deleted_at IS NULL
        ${userId ? sql`AND (src.user_id = ${userId}::uuid OR tgt.user_id = ${userId}::uuid)` : sql``}
        ${workspaceId ? sql`AND sl.workspace_id = ${workspaceId}::uuid` : sql``}
        ${spaceId ? sql`AND ((st.metadata->>'spaceId') = ${spaceId} OR (tt.metadata->>'spaceId') = ${spaceId})` : sql``}
      ORDER BY sl.similarity DESC, sl.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `)

    const rowsArray: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])

    const truncate = (v: unknown): string =>
      typeof v === 'string' ? (v as string).slice(0, 240) : ''

    const data = rowsArray.map((r) => ({
      id: String(r['id']),
      workspaceId: r['workspace_id'] ? String(r['workspace_id']) : null,
      similarity: Number(r['similarity'] ?? 0),
      linkType: r['link_type'] ? String(r['link_type']) : '',
      crossUser: !!r['cross_user'],
      reason: r['reason'] ? String(r['reason']) : null,
      createdAt: r['created_at'] ? String(r['created_at']) : null,
      source: {
        id: String(r['source_id']),
        userId: r['source_user_id'] ? String(r['source_user_id']) : null,
        userName: r['source_user_name'] ? String(r['source_user_name']) : '',
        doc: r['source_doc'] ? String(r['source_doc']) : null,
        text: truncate(r['source_text']),
        magnitude: r['source_magnitude'] ? String(r['source_magnitude']) : null,
      },
      target: {
        id: String(r['target_id']),
        userId: r['target_user_id'] ? String(r['target_user_id']) : null,
        userName: r['target_user_name'] ? String(r['target_user_name']) : '',
        doc: r['target_doc'] ? String(r['target_doc']) : null,
        text: truncate(r['target_text']),
        magnitude: r['target_magnitude'] ? String(r['target_magnitude']) : null,
      },
    }))

    return c.json({ data, error: null, limit, offset })
  } catch (e: unknown) {
    return c.json(
      {
        data: [],
        error: { code: 'QUERY_FAILED', message: e instanceof Error ? e.message : String(e) },
      },
      500
    )
  }
})

// GET /shadow — GRAPH-1. When the pipeline-graph flag is on, run the
// router-over-shared-state harness in shadow (no writes) on a tiny fixture and
// render the nodeLog + shadow verdict. Off ⇒ { active: false }.
devGraphRouter.get('/shadow', async (c) => {
  const { isServerFeatureActive } = await import('../config/server-vault')
  if (!isServerFeatureActive('pipeline-graph')) {
    return c.json({ active: false, message: 'pipeline-graph flag is off' })
  }
  try {
    const { runPipelineGraph } = await import('../services/pipeline/graph/index')
    const { state, verdict } = await runPipelineGraph({
      persist: false,
      userId: 'dev',
      workspaceId: 'dev',
      mode: 'scheduled',
      events: [
        {
          userId: 'dev',
          workspaceId: 'dev',
          rawText: 'Shipped the pricing change after the Friday review.',
          provenance: {
            source_tool: 'manual',
            source_type: 'chat',
            contributor: 'dev',
            timestamp: new Date().toISOString(),
          },
          scopeTags: [],
        },
      ],
    })
    return c.json({ active: true, nodeLog: state.nodeLog, verdict })
  } catch (e: unknown) {
    return c.json(
      { active: true, error: e instanceof Error ? e.message : String(e), nodeLog: [] },
      500
    )
  }
})
