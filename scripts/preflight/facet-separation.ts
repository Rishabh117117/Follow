/* eslint-disable no-console -- CLI preflight script; console IS the output. */
/**
 * ANALYST-ON-1 · PRE-1 — Facet separation reality check (GATE)
 *
 * The ANALYST contradiction geometry depends on the CONTENT and CAUSAL facet
 * embeddings *diverging*. If they collapse to (nearly) the same vector — e.g.
 * because `composeCausalFacet` falls back to `event.label` whenever a record
 * carries no contextNotes/chatQuestion/outcome/keyChange — then
 * `isContradictionCandidate` (content ≥ 0.7 AND causal ≤ 0.45) either never
 * fires or fires on noise, and flipping `pipeline-analyst-llm` would pay
 * deepseek-v4-pro for nothing.
 *
 * This script measures that, against a LIVE Postgres. It does NOT need an LLM
 * key. It also doubles as the cost dry-run (count of pairs that WOULD be
 * classified).
 *
 *   Run:  npx tsx scripts/preflight/facet-separation.ts
 *   Env:  DATABASE_URL must point at the deploy/staging Postgres.
 *
 * GATE interpretation (see ANALYST-ON-1 sprint §PRE-1):
 *   - If the content-cosine vs causal-cosine Pearson r ≈ 1.0, the facets are
 *     DEGENERATE → do NOT flip the flag; fix composeContentFacet/
 *     composeCausalFacet to diverge (or widen thresholds) first.
 *   - The contradiction-candidate count is the # of below-threshold pairs the
 *     ANALYST would be asked to classify because of the facet geometry — i.e.
 *     the whole point of turning ANALYST on. If it's ~0, the value is ~0.
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// Load the api package env so DATABASE_URL resolves the same way the server does.
config({ path: resolve(__dir, 'packages/api/.env.local') })
config({ path: resolve(__dir, 'packages/api/.env') })
config({ path: resolve(__dir, '.env') })

import { sql } from 'drizzle-orm'
import { db, waitForDb } from '../../packages/api/src/db/index'
import { indexRecords } from '../../packages/api/src/db/schema/semantic-index'

// Thresholds — keep in sync with indexer.ts / facet-signal.ts.
const CONTRADICTION_CONTENT_MIN = 0.7
const CONTRADICTION_CAUSAL_MAX = 0.45
const LINK_THRESHOLD_SAME = 0.55
const LINK_THRESHOLD_CROSS = 0.65

const SAMPLE_RECORDS = 500
const RANDOM_PAIRS = 2000

function cosine(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n === 0) return NaN
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i++) {
    sx += xs[i]!
    sy += ys[i]!
  }
  const mx = sx / n
  const my = sy / n
  let cov = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx
    const dy = ys[i]! - my
    cov += dx * dy
    vx += dx * dx
    vy += dy * dy
  }
  if (vx === 0 || vy === 0) return NaN
  return cov / Math.sqrt(vx * vy)
}

function dist(values: number[], label: string): void {
  if (values.length === 0) {
    console.log(`  ${label}: (no samples)`)
    return
  }
  const s = [...values].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  console.log(
    `  ${label}: min=${s[0]!.toFixed(3)} median=${at(0.5).toFixed(3)} ` +
      `mean=${mean.toFixed(3)} p90=${at(0.9).toFixed(3)} max=${s[s.length - 1]!.toFixed(3)}`
  )
}

type Row = {
  id: string
  threadId: string | null
  content: number[] | null
  causal: number[] | null
  context: number[] | null
  composite: number[] | null
}

async function main() {
  await waitForDb()
  console.log('=== ANALYST-ON-1 · PRE-1 facet separation ===\n')

  // Sample records that carry all three facets + the composite.
  const rows = (await db.execute(sql`
    SELECT id,
           thread_id          AS "threadId",
           embedding_content  AS content,
           embedding_causal   AS causal,
           embedding_context  AS context,
           embedding          AS composite
    FROM ${indexRecords}
    WHERE embedding_content IS NOT NULL
      AND embedding_causal  IS NOT NULL
      AND embedding_context IS NOT NULL
      AND deleted_at IS NULL
    ORDER BY random()
    LIMIT ${SAMPLE_RECORDS}
  `)) as unknown as { rows?: Row[] } | Row[]

  // drizzle's execute() return shape varies by driver; normalize.
  const sample: Row[] = Array.isArray(rows) ? rows : (rows.rows ?? [])
  const parse = (v: unknown): number[] | null => {
    if (Array.isArray(v)) return v as number[]
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as number[]
      } catch {
        return null
      }
    }
    return null
  }
  const recs = sample.map((r) => ({
    id: r.id,
    threadId: r.threadId,
    content: parse(r.content),
    causal: parse(r.causal),
    context: parse(r.context),
    composite: parse(r.composite),
  }))

  console.log(`Sampled ${recs.length} records with full facet triples.\n`)
  if (recs.length < 2) {
    console.log('Not enough records to form pairs. Index more data, then re-run.')
    process.exit(0)
  }

  const contentCos: number[] = []
  const causalCos: number[] = []
  const contextCos: number[] = []
  const compositeCos: number[] = []
  let contradictionCandidates = 0
  let aboveThreshold = 0

  for (let p = 0; p < RANDOM_PAIRS; p++) {
    const i = Math.floor(Math.random() * recs.length)
    let j = Math.floor(Math.random() * recs.length)
    if (i === j) j = (j + 1) % recs.length
    const A = recs[i]!
    const B = recs[j]!

    const cc = cosine(A.content, B.content)
    const cz = cosine(A.causal, B.causal)
    const cx = cosine(A.context, B.context)
    const comp = cosine(A.composite, B.composite)
    contentCos.push(cc)
    causalCos.push(cz)
    contextCos.push(cx)
    compositeCos.push(comp)

    if (cc >= CONTRADICTION_CONTENT_MIN && cz <= CONTRADICTION_CAUSAL_MAX) {
      contradictionCandidates++
    }
    const threshold =
      A.threadId && A.threadId === B.threadId ? LINK_THRESHOLD_SAME : LINK_THRESHOLD_CROSS
    if (comp >= threshold) aboveThreshold++
  }

  console.log('Cosine distributions over random pairs:')
  dist(contentCos, 'content')
  dist(causalCos, 'causal ')
  dist(contextCos, 'context')
  dist(compositeCos, 'composite')

  const rContentCausal = pearson(contentCos, causalCos)
  console.log('\nPearson correlation (content-cosine vs causal-cosine):')
  console.log(`  r = ${rContentCausal.toFixed(4)}`)
  if (rContentCausal >= 0.95) {
    console.log('  ⚠️  DEGENERATE — content and causal framings collapse. GATE FAILS.')
    console.log('     Do NOT flip pipeline-analyst-llm; fix the facet composition first.')
  } else if (rContentCausal >= 0.85) {
    console.log('  ⚠️  borderline — facets weakly separated; review before flipping.')
  } else {
    console.log('  ✅ facets are separated enough for the contradiction geometry.')
  }

  console.log('\nPair counts (out of', RANDOM_PAIRS, 'random pairs):')
  console.log(
    `  contradiction-candidates (content≥${CONTRADICTION_CONTENT_MIN} & causal≤${CONTRADICTION_CAUSAL_MAX}): ${contradictionCandidates}`
  )
  console.log(`  above link threshold (would classify anyway): ${aboveThreshold}`)
  console.log(
    `\nCost dry-run: ~${aboveThreshold + contradictionCandidates} of ${RANDOM_PAIRS} sampled pairs ` +
      `would hit ANALYST. Scale by your real candidate volume per index batch (≤ inserted × 20).`
  )

  process.exit(0)
}

main().catch((err) => {
  console.error('[PRE-1] failed:', err)
  process.exit(1)
})
