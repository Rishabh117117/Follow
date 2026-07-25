/**
 * Queue Bridge — Sessions → Index Queue (2026-04-29)
 *
 * Subscribes to session.started / session.ended and enqueues the
 * corresponding Archivist + Profiler runs. Also installs the two crons
 * (5-min Archivist tick, daily Profiler 14d slice).
 *
 * Reuses services/indexing/index-queue (per the plan: "lets reuse"). The
 * queue's existing dedup-by-(sourceId, type) collapses overlapping runs,
 * so a 5-min cron tick that arrives during a session_start is a no-op.
 */

import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { sql } from 'drizzle-orm'
import { db } from '../../db/index'
import { enqueueIndexJob, type IndexJobType } from '../indexing/index-queue'
import { sessionEvents } from './index'
import type { PipelineMode } from '../pipeline/runner'

// ─── Enqueue helpers ───────────────────────────────────────────────────────

function enqueuePipelineJob(opts: {
  type: 'archivist_run' | 'profiler_run'
  userId: string
  workspaceId: string
  mode: PipelineMode
  sessionId?: string
}): void {
  const jobType: IndexJobType = opts.type
  enqueueIndexJob({
    type: jobType,
    sourceType: 'pipeline_role',
    sourceId: opts.userId, // dedup key is (sourceId, type) — userId works
    workspaceId: opts.workspaceId,
    metadata: {
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      mode: opts.mode,
      sessionId: opts.sessionId,
    },
  })
}

// ─── Subscribers ───────────────────────────────────────────────────────────

let installed = false

export function installSessionToQueueBridge(): void {
  if (installed) return
  installed = true

  sessionEvents.on('session.started', ({ sessionId, userId, workspaceId }) => {
    enqueuePipelineJob({
      type: 'archivist_run',
      userId,
      workspaceId,
      mode: 'session_start',
      sessionId,
    })
    enqueuePipelineJob({
      type: 'profiler_run',
      userId,
      workspaceId,
      mode: 'session_start',
      sessionId,
    })
  })

  sessionEvents.on('session.ended', ({ sessionId, userId, workspaceId }) => {
    enqueuePipelineJob({
      type: 'archivist_run',
      userId,
      workspaceId,
      mode: 'session_end',
      sessionId,
    })
    enqueuePipelineJob({
      type: 'profiler_run',
      userId,
      workspaceId,
      mode: 'session_end',
      sessionId,
    })
  })

  console.info('[sessions] queue bridge installed (session.started / session.ended → archivist + profiler)')
}

// ─── Crons ─────────────────────────────────────────────────────────────────

let cronArchivist: ScheduledTask | null = null
let cronProfiler: ScheduledTask | null = null
let cronGc: ScheduledTask | null = null

/**
 * 5-min Archivist tick: enqueue an archivist_run for every user that has at
 * least one tentative record older than 5 minutes. Dedup at the queue layer
 * means we won't double up on a user whose session_start just fired.
 *
 * For now we enqueue against any user who has a recent index_records row —
 * the real implementation will filter to "has tentative records older than
 * 5 min" once index_record_states is fully wired.
 */
async function tickArchivist(): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT user_id, workspace_id
      FROM index_records
      WHERE indexed_at > now() - interval '15 minutes'
      LIMIT 200
    `)
    const list: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])
    for (const r of list) {
      const userId = r['user_id'] ? String(r['user_id']) : null
      const workspaceId = r['workspace_id'] ? String(r['workspace_id']) : null
      if (!userId || !workspaceId) continue
      enqueuePipelineJob({
        type: 'archivist_run',
        userId,
        workspaceId,
        mode: 'scheduled',
      })
    }
  } catch (err) {
    console.error('[Archivist] cron tick failed:', err)
  }
}

/**
 * Daily Profiler 14d slice: uniform pass for ALL users (per the plan —
 * "we'll go for a more uniform approach"). Runs at 03:15 server time.
 */
async function tickProfilerDaily(): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT user_id, workspace_id
      FROM index_records
      WHERE indexed_at > now() - interval '14 days'
    `)
    const list: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])
    for (const r of list) {
      const userId = r['user_id'] ? String(r['user_id']) : null
      const workspaceId = r['workspace_id'] ? String(r['workspace_id']) : null
      if (!userId || !workspaceId) continue
      enqueuePipelineJob({
        type: 'profiler_run',
        userId,
        workspaceId,
        mode: 'rolling_14d',
      })
    }
  } catch (err) {
    console.error('[Profiler] daily cron failed:', err)
  }
}

/**
 * Daily tombstone GC pass: hard-deletes index_records past retention,
 * recomputes drifted episode counters, prunes dead UUIDs from
 * user_patterns.supportingRecordIds. Runs at 03:45 — after the Profiler
 * daily pass at 03:15 so freshly-emitted patterns don't get pruned mid-run.
 */
async function tickGcDaily(): Promise<void> {
  try {
    const { runTombstoneGC } = await import('../pipeline/gc')
    const result = await runTombstoneGC()
    if (result.hardDeletedRecords > 0 || result.patternsDeleted > 0 || result.rawFilesMarkedPurgeable > 0) {
      console.info(
        `[GC] hardDeletedRecords=${result.hardDeletedRecords} ` +
          `stateRows=${result.hardDeletedStateRows} ` +
          `episodesRecomputed=${result.episodesRecomputed} ` +
          `patternsPruned=${result.patternsPruned} ` +
          `patternsDeleted=${result.patternsDeleted} ` +
          `rawFilesMarkedPurgeable=${result.rawFilesMarkedPurgeable}`
      )
    }
  } catch (err) {
    console.error('[GC] daily cron failed:', err)
  }
}

export function startPipelineCrons(): void {
  // 5-min Archivist tick. */5 = every 5 minutes.
  if (!cronArchivist) {
    cronArchivist = cron.schedule('*/5 * * * *', () => {
      void tickArchivist()
    })
    console.info('[sessions] Archivist cron started (every 5 min)')
  }

  // Daily Profiler 14d slice at 03:15 local time.
  if (!cronProfiler) {
    cronProfiler = cron.schedule('15 3 * * *', () => {
      void tickProfilerDaily()
    })
    console.info('[sessions] Profiler daily cron started (03:15)')
  }

  // Daily tombstone GC at 03:45 — runs after Profiler so freshly-emitted
  // patterns don't get pruned mid-run.
  if (!cronGc) {
    cronGc = cron.schedule('45 3 * * *', () => {
      void tickGcDaily()
    })
    console.info('[sessions] Tombstone GC cron started (03:45)')
  }
}

export function stopPipelineCrons(): void {
  if (cronArchivist) {
    cronArchivist.stop()
    cronArchivist = null
  }
  if (cronProfiler) {
    cronProfiler.stop()
    cronProfiler = null
  }
  if (cronGc) {
    cronGc.stop()
    cronGc = null
  }
}
