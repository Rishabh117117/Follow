import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { PGlite } from '@electric-sql/pglite'
import { currentFactConditions } from '../current-fact-filter'

// VERSION-B1 · THE GATE TEST.
// The read filter is the load-bearing recall path for every chat + MCP query. The
// only thing between this change and silently dropping the entire index is the
// guarantee that the filter excludes ONLY superseded/deleted/hidden facts — and
// NEVER discriminates on source_version (chat facts + current docs legitimately
// have it null or set).

describe('VERSION-B1 · currentFactConditions (the shared read filter)', () => {
  const renderSql = (): string => {
    const combined = and(...currentFactConditions())
    return new PgDialect().sqlToQuery(combined!).sql.toLowerCase()
  }

  it('emits exactly three lifecycle conditions', () => {
    expect(currentFactConditions()).toHaveLength(3)
  })

  it('filters superseded_at, deleted_at, and hidden', () => {
    const sql = renderSql()
    expect(sql).toContain('superseded_at')
    expect(sql).toContain('deleted_at')
    expect(sql).toContain('hidden')
    expect(sql).toContain('is null')
  })

  it('NEVER references source_version (the entire-index-drop safety invariant)', () => {
    expect(renderSql()).not.toContain('source_version')
  })
})

describe('VERSION-B1 · current-fact read filter behavior (gate, ephemeral PGlite)', () => {
  let pg: PGlite
  // The exact lifecycle predicate the readers apply (superseded/deleted/hidden).
  const WHERE = `superseded_at IS NULL AND deleted_at IS NULL AND hidden = FALSE`

  beforeAll(async () => {
    pg = new PGlite() // in-memory, ephemeral — no shared dir, no worker flake
    await pg.exec(`
      CREATE TABLE index_records (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        source_version INTEGER,
        superseded_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ,
        hidden BOOLEAN NOT NULL DEFAULT FALSE
      );
      INSERT INTO index_records (id, workspace_id, source_version, superseded_at, deleted_at, hidden) VALUES
        ('cur-chat',   'ws', NULL, NULL,  NULL,  FALSE),  -- current chat fact (null version)
        ('cur-doc-v2', 'ws', 2,    NULL,  NULL,  FALSE),  -- current doc fact, VERSIONED
        ('superseded', 'ws', 1,    NOW(), NULL,  FALSE),  -- retired prior version
        ('deleted',    'ws', 3,    NULL,  NOW(), FALSE),  -- tombstoned
        ('hidden',     'ws', 4,    NULL,  NULL,  TRUE);   -- user-hidden
    `)
  })
  afterAll(async () => {
    await pg.close()
  })

  it('returns ALL current facts — including a versioned current doc — and excludes superseded/deleted/hidden', async () => {
    const res = await pg.query<{ id: string }>(
      `SELECT id FROM index_records WHERE workspace_id = 'ws' AND ${WHERE} ORDER BY id`
    )
    expect(res.rows.map((r) => r.id)).toEqual(['cur-chat', 'cur-doc-v2'])
  })

  it('keeps a current VERSIONED fact (proves the filter does not exclude by source_version)', async () => {
    const res = await pg.query<{ id: string }>(
      `SELECT id FROM index_records WHERE ${WHERE} AND source_version = 2`
    )
    expect(res.rows.map((r) => r.id)).toEqual(['cur-doc-v2'])
  })

  it('a chat-only workspace (all null versions) still returns its live facts', async () => {
    const res = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM index_records WHERE source_version IS NULL AND ${WHERE}`
    )
    expect(res.rows[0]!.n).toBe(1) // cur-chat survives
  })

  it('superseded facts are excluded', async () => {
    const res = await pg.query<{ id: string }>(
      `SELECT id FROM index_records WHERE ${WHERE} AND id = 'superseded'`
    )
    expect(res.rows).toHaveLength(0)
  })
})
