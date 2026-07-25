/**
 * Pipeline graph entry (GRAPH-1 · 2026-06-02)
 *
 * Runs the router-over-shared-state harness and computes the shadow verdict.
 * Shadow (`persist=false`) performs no DB writes; the live path (`persist=true`)
 * can attach the Postgres checkpointer for durable runs.
 */

import { computeShadowVerdict, type ShadowVerdict, type PipelineState } from '@workspace/shared'
import type { ReportEventInput } from '../reporter'
import type { PipelineMode } from '../runner'
import { buildPipelineGraph, buildArchivistGraph, buildProfilerGraph } from './graph'
import type { PipelineGraphStateType } from './state'

export interface RunPipelineGraphOptions {
  /** false ⇒ shadow (no writes); true ⇒ live (compute + commit). */
  persist?: boolean
  userId?: string
  workspaceId?: string
  mode?: PipelineMode
  events?: ReportEventInput[]
}

export async function runPipelineGraph(
  opts: RunPipelineGraphOptions
): Promise<{ state: PipelineGraphStateType; verdict: ShadowVerdict }> {
  const graph = buildPipelineGraph()
  const result = await graph.invoke({
    meta: {
      persist: opts.persist ?? false,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      mode: opts.mode,
    },
    events: opts.events ?? [],
  })
  return { state: result, verdict: computeShadowVerdict({ facts: result.facts }) }
}

export function shadowVerdict(state: Pick<PipelineState, 'facts'>): ShadowVerdict {
  return computeShadowVerdict(state)
}

/**
 * Postgres checkpointer entry for durable/live runs. Lazy so the shadow path
 * and tests need no database.
 */
export async function getPostgresCheckpointer(connectionString: string) {
  const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres')
  const saver = PostgresSaver.fromConnString(connectionString)
  await saver.setup()
  return saver
}

// ─── GRAPH-WIRE-1 · checkpointed single-role runner for the queue path ───────
//
// `setup()` (table creation) runs once: the checkpointer is memoized per
// connection string. If DATABASE_URL is absent (tests / PGlite), we run the
// role graph without a checkpointer — still functionally correct, just not
// resumable.

type Checkpointer = Awaited<ReturnType<typeof getPostgresCheckpointer>>
let checkpointerPromise: Promise<Checkpointer> | null = null
let checkpointerConn: string | null = null

async function getCachedCheckpointer(
  connectionString: string | undefined
): Promise<Checkpointer | undefined> {
  if (!connectionString) return undefined
  if (!checkpointerPromise || checkpointerConn !== connectionString) {
    checkpointerConn = connectionString
    checkpointerPromise = getPostgresCheckpointer(connectionString)
  }
  return checkpointerPromise
}

export async function runRoleGraph(opts: {
  role: 'archivist' | 'profiler'
  userId: string
  workspaceId: string
  mode: PipelineMode
}): Promise<PipelineGraphStateType> {
  const checkpointer = await getCachedCheckpointer(process.env.DATABASE_URL)
  const graph =
    opts.role === 'archivist' ? buildArchivistGraph(checkpointer) : buildProfilerGraph(checkpointer)
  const threadId = `${opts.role}:${opts.userId}:${opts.workspaceId}:${opts.mode}`
  return graph.invoke(
    {
      meta: {
        persist: true,
        userId: opts.userId,
        workspaceId: opts.workspaceId,
        mode: opts.mode,
      },
      events: [],
    },
    checkpointer ? { configurable: { thread_id: threadId } } : undefined
  )
}

export { buildPipelineGraph, buildArchivistGraph, buildProfilerGraph } from './graph'
export { PipelineGraphState } from './state'
