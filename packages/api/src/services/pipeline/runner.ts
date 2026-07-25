/**
 * Pipeline Runner — dispatch shell for the 5 LLM roles (2026-04-29).
 *
 * Receives queue jobs of type 'archivist_run' or 'profiler_run' and routes
 * them to the right role handler. The handlers themselves are planned stubs
 * until the real Archivist/Profiler call sites land — they log + finish so
 * the queue stays clean and the dashboard can see jobs flowing through.
 *
 * Job metadata shape (set by services/sessions/queue-bridge.ts):
 *   {
 *     userId: string,
 *     workspaceId: string,
 *     mode: 'session_start' | 'session_end' | 'scheduled' | 'rolling_14d',
 *     sessionId?: string,    // present for session_start / session_end
 *   }
 *
 * sourceType is 'pipeline_role'; sourceId is the userId. We dedup on
 * (sourceId, type) at the queue layer, so a 5-min cron tick that overlaps
 * a session_start collapses to one run automatically.
 */

import type { NodeLogEntry } from '@workspace/shared'
import { isServerFeatureActive } from '../../config/server-vault'
import type { IndexJob } from '../indexing/index-queue'

export type PipelineMode = 'session_start' | 'session_end' | 'scheduled' | 'rolling_14d'

interface PipelineMeta {
  userId: string
  workspaceId: string
  mode: PipelineMode
  sessionId?: string
  /** keep_tentative cycle count — used by Archivist to force a decision after 3 cycles */
  cycle?: number
}

function readMeta(job: IndexJob): PipelineMeta | null {
  const m = job.metadata as Partial<PipelineMeta> | undefined
  if (!m?.userId || !m?.workspaceId || !m?.mode) return null
  return {
    userId: m.userId,
    workspaceId: m.workspaceId,
    mode: m.mode,
    sessionId: m.sessionId,
    cycle: typeof m.cycle === 'number' ? m.cycle : 0,
  }
}

/**
 * The graph's nodeLog accumulates across ticks on a stable thread_id (append
 * reducer). Return the counts of the most recent entry for `node` — that is the
 * current tick's result. Empty object if the node didn't run.
 */
function lastCounts(nodeLog: NodeLogEntry[], node: string): Record<string, number> {
  for (let i = nodeLog.length - 1; i >= 0; i--) {
    const entry = nodeLog[i]
    if (entry?.node === node) return entry.counts ?? {}
  }
  return {}
}

/**
 * GRAPH-WIRE-1: route consolidation through the LangGraph harness when the
 * `pipeline-graph` flag is active and the env rollback switch isn't set. Either
 * lever (flag off OR `PIPELINE_GRAPH_DISABLE=1`) reverts to the legacy direct
 * call — matching the rollback runbook.
 */
function usePipelineGraph(): boolean {
  return isServerFeatureActive('pipeline-graph') && process.env.PIPELINE_GRAPH_DISABLE !== '1'
}

// ─── Archivist (Stage 06 · Promote → states) ───────────────────────────────

export async function handleArchivistRun(job: IndexJob): Promise<void> {
  const meta = readMeta(job)
  if (!meta) {
    console.warn(`[Archivist] job ${job.id} missing required metadata; skipping`)
    return
  }
  const startedAt = Date.now()

  // GRAPH-WIRE-1: route through the single-role LangGraph + Postgres
  // checkpointer (durable/resumable). Either rollback lever (flag off or
  // `PIPELINE_GRAPH_DISABLE=1`) reverts to the legacy direct call. Outputs are
  // identical: the graph runs exactly the same compute/commit role, DB-driven
  // and independent of graph state.
  if (!usePipelineGraph()) {
    const { runArchivist } = await import('./archivist')
    const result = await runArchivist({
      userId: meta.userId,
      workspaceId: meta.workspaceId,
      mode: meta.mode,
      sessionId: meta.sessionId,
      cycleHint: meta.cycle ?? 0,
    })
    console.info(
      `[Archivist] mode=${meta.mode} user=${meta.userId.slice(0, 8)} ` +
        `promoted=${result.promoted} demoted=${result.demoted} ` +
        `superseded=${result.superseded} keptTentative=${result.keptTentative} ` +
        `skipped=${result.skipped} ${Date.now() - startedAt}ms (direct)`
    )
    return
  }

  const { runRoleGraph } = await import('./graph/index')
  const state = await runRoleGraph({
    role: 'archivist',
    userId: meta.userId,
    workspaceId: meta.workspaceId,
    mode: meta.mode,
  })
  // nodeLog accumulates across ticks on the stable thread_id; the current run is
  // the last archivist entry.
  const c = lastCounts(state.nodeLog, 'archivist')
  console.info(
    `[Archivist] mode=${meta.mode} user=${meta.userId.slice(0, 8)} ` +
      `promoted=${c.promoted ?? 0} demoted=${c.demoted ?? 0} ` +
      `superseded=${c.superseded ?? 0} keptTentative=${c.keptTentative ?? 0} ` +
      `skipped=${c.skipped ?? 0} ${Date.now() - startedAt}ms (graph)`
  )
}

// ─── Profiler (Stage 07 · Pattern → patterns) ─────────────────────────────

export async function handleProfilerRun(job: IndexJob): Promise<void> {
  const meta = readMeta(job)
  if (!meta) {
    console.warn(`[Profiler] job ${job.id} missing required metadata; skipping`)
    return
  }
  const startedAt = Date.now()

  // GRAPH-WIRE-1: see handleArchivistRun. Same single-role graph routing for the
  // profiler, with the same flag + `PIPELINE_GRAPH_DISABLE=1` rollback levers.
  if (!usePipelineGraph()) {
    const { runProfiler } = await import('./profiler')
    const result = await runProfiler({
      userId: meta.userId,
      workspaceId: meta.workspaceId,
      mode: meta.mode,
      sessionId: meta.sessionId,
    })
    if (result.skipped) {
      console.info(
        `[Profiler] mode=${meta.mode} user=${meta.userId.slice(0, 8)} skipped (insufficient data or LLM failure) (direct)`
      )
      return
    }
    console.info(
      `[Profiler] mode=${meta.mode} user=${meta.userId.slice(0, 8)} ` +
        `runId=${result.runId?.slice(0, 8)} patterns=${result.patternsWritten} ` +
        `edgePriors=${result.edgePriorsWritten} ${Date.now() - startedAt}ms (direct)`
    )
    return
  }

  const { runRoleGraph } = await import('./graph/index')
  const state = await runRoleGraph({
    role: 'profiler',
    userId: meta.userId,
    workspaceId: meta.workspaceId,
    mode: meta.mode,
  })
  const c = lastCounts(state.nodeLog, 'profiler')
  if ((c.skipped ?? 0) === 1) {
    console.info(
      `[Profiler] mode=${meta.mode} user=${meta.userId.slice(0, 8)} skipped (insufficient data or LLM failure) (graph)`
    )
    return
  }
  console.info(
    `[Profiler] mode=${meta.mode} user=${meta.userId.slice(0, 8)} ` +
      `patterns=${c.patternsWritten ?? 0} ` +
      `edgePriors=${c.edgePriorsWritten ?? 0} ${Date.now() - startedAt}ms (graph)`
  )
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

export async function dispatchPipelineJob(job: IndexJob): Promise<void> {
  switch (job.type) {
    case 'archivist_run':
      await handleArchivistRun(job)
      return
    case 'profiler_run':
      await handleProfilerRun(job)
      return
    default:
      console.warn(`[Pipeline] unhandled job type: ${job.type}`)
      return
  }
}
