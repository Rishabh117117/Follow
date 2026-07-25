/**
 * Pipeline router graph (GRAPH-1 · 2026-06-02)
 *
 * REPORTER → (router) → ARCHIVIST → PROFILER over a single shared PipelineState.
 * The router reads the shared state: it only enters the persisting roles when
 * the REPORTER actually produced facts.
 */

import { StateGraph, START, END, type BaseCheckpointSaver } from '@langchain/langgraph'
import { PipelineGraphState, type PipelineGraphStateType } from './state'
import { reporterNode, archivistNode, profilerNode } from './nodes/index'

function routeAfterReporter(state: PipelineGraphStateType): string {
  return state.facts.length > 0 ? 'archivist' : END
}

export function buildPipelineGraph() {
  return new StateGraph(PipelineGraphState)
    .addNode('reporter', reporterNode)
    .addNode('archivist', archivistNode)
    .addNode('profiler', profilerNode)
    .addEdge(START, 'reporter')
    .addConditionalEdges('reporter', routeAfterReporter)
    .addEdge('archivist', 'profiler')
    .addEdge('profiler', END)
    .compile()
}

// ─── GRAPH-WIRE-1 · single-role graphs for the queue path ───────────────────
//
// A queue consolidation tick carries no events ⇒ REPORTER produces 0 facts ⇒
// `routeAfterReporter` returns END ⇒ archivist/profiler never run. So the full
// router graph cannot serve the queue path. These single-role graphs run
// exactly one persisting role (no reporter fact-gate), preserving the exact
// per-job semantics of the legacy direct `runArchivist`/`runProfiler` calls
// while putting the graph + Postgres checkpointer on the production path.
//
// The checkpointer (if supplied) is attached at compile time — verified against
// @langchain/langgraph@1.3.4, whose `.compile({ checkpointer })` accepts it and
// pairs with `.invoke(input, { configurable: { thread_id } })`.

export function buildArchivistGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(PipelineGraphState)
    .addNode('archivist', archivistNode)
    .addEdge(START, 'archivist')
    .addEdge('archivist', END)
    .compile(checkpointer ? { checkpointer } : undefined)
}

export function buildProfilerGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(PipelineGraphState)
    .addNode('profiler', profilerNode)
    .addEdge(START, 'profiler')
    .addEdge('profiler', END)
    .compile(checkpointer ? { checkpointer } : undefined)
}
