/**
 * Pipeline graph nodes (GRAPH-1 · 2026-06-02)
 *
 * Each node reads the shared PipelineState and returns a partial update. The
 * Archivist/Profiler nodes call SPLIT-1's `compute*` always (read + decide) and
 * `commit*` only when `meta.persist` is true — so a shadow run (persist=false)
 * performs no DB writes.
 */

import { randomUUID } from 'node:crypto'
import type { PipelineFact } from '@workspace/shared'
import { reportEvent } from '../../reporter'
import { computeArchivist, commitArchivist } from '../../archivist'
import { computeProfiler, commitProfiler } from '../../profiler'
import type { PipelineMode } from '../../runner'
import type { PipelineGraphStateType } from '../state'

type Update = Partial<PipelineGraphStateType>

export async function reporterNode(state: PipelineGraphStateType): Promise<Update> {
  const facts: PipelineFact[] = []
  for (const ev of state.events ?? []) {
    const node = await reportEvent(ev)
    if (node && 'embedding_text' in node && node.skip === false) {
      facts.push({
        id: randomUUID(),
        text: node.summary,
        topics: node.topics ?? [],
        confidence: node.confidence ?? 0,
        contributor: ev.provenance.contributor,
      })
    }
  }
  const contributors = facts
    .map((f) => f.contributor)
    .filter((c): c is string => typeof c === 'string')
  return {
    facts,
    contributors,
    nodeLog: [{ node: 'reporter', persist: state.meta.persist, counts: { facts: facts.length } }],
  }
}

function roleInput(state: PipelineGraphStateType) {
  return {
    userId: state.meta.userId ?? '',
    workspaceId: state.meta.workspaceId ?? '',
    mode: (state.meta.mode as PipelineMode | undefined) ?? 'scheduled',
  }
}

export async function archivistNode(state: PipelineGraphStateType): Promise<Update> {
  const persist = state.meta.persist
  const computation = await computeArchivist(roleInput(state))
  const counts: Record<string, number> = {
    tentatives: computation.tentatives.length,
    decisions: computation.decisions?.length ?? 0,
  }
  if (persist) {
    const r = await commitArchivist(computation)
    counts.promoted = r.promoted
    counts.demoted = r.demoted
    counts.superseded = r.superseded
    counts.keptTentative = r.keptTentative
    counts.skipped = r.skipped
  }
  return { nodeLog: [{ node: 'archivist', persist, counts }] }
}

export async function profilerNode(state: PipelineGraphStateType): Promise<Update> {
  const persist = state.meta.persist
  const computation = await computeProfiler(roleInput(state))
  const counts: Record<string, number> = {
    records: computation.records.length,
    ran: computation.ran ? 1 : 0,
  }
  const profileDelta: Record<string, unknown> = computation.llmResponse
    ? {
        workStyleNarrative: computation.llmResponse.workStyleNarrative,
        patterns: computation.llmResponse.patterns.length,
      }
    : {}
  if (persist) {
    const r = await commitProfiler(computation)
    counts.patternsWritten = r.patternsWritten
    counts.edgePriorsWritten = r.edgePriorsWritten
    counts.skipped = r.skipped ? 1 : 0
  }
  return { profileDelta, nodeLog: [{ node: 'profiler', persist, counts }] }
}
