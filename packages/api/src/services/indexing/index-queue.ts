/**
 * Index Queue
 *
 * In-memory priority job queue for document indexing.
 * Processes jobs with concurrency control, deduplication, and retry.
 *
 * Progress model:
 *   Each job exposes a rich `progress` record (chunks_total / chunks_done,
 *   current phase, per-phase timings) that the indexing agent updates as it
 *   walks the pipeline. ETA is computed from a rolling median over the last
 *   N chunk wall-times in the current phase, not from bytes.
 *
 * Cancellation:
 *   `cancelIndexJob(id)` sets a flag that the agent (and any long-running
 *   subcall) checks via `isCancelled(job)`. The job's AbortSignal is also
 *   available on `job.abortSignal` for wire-level cancellation.
 */
import { EventEmitter } from 'events'
import {
  loadQueueState,
  saveQueueState,
  type PersistedQueueState,
  type SnapshotJob,
} from './queue-state-store'

// ─── Types ────────────────────────────────────────────────────────────────

export type IndexJobType =
  | 'full_index'
  | 'incremental_index'
  | 'health_sweep'
  // Pipeline-role jobs (2026-04-29). sourceType='pipeline_role', sourceId=userId.
  // Handler stubs live in services/pipeline/{archivist,profiler}.ts; until the
  // real Archivist/Profiler call sites land they no-op + log.
  | 'archivist_run'
  | 'profiler_run'

export type IndexPhase =
  | 'queued'
  | 'chunking'
  | 'enriching'
  | 'embedding'
  | 'storing'
  | 'done'
  | 'cancelled'
  | 'error'

export interface IndexProgress {
  phase: IndexPhase
  chunksTotal: number
  chunksDone: number
  /** Recently-measured ms/chunk in the current phase (rolling median). */
  msPerChunk: number
  /** Remaining ms, computed from (chunksTotal - chunksDone) × msPerChunk. */
  etaMs: number | null
  /** Wall-clock when this job started processing. */
  startedAt: Date | null
  /** Per-phase elapsed ms. */
  phaseTimings: Partial<Record<IndexPhase, number>>
  message?: string
  /**
   * Actual USD billed so far — accumulated from each LLM / embedding call.
   * Lets the dashboard show "$0.37 spent so far on this folder" live.
   */
  actualCostUsd: number
  /**
   * Rough forward estimate based on chunksTotal and the model tiers the
   * pipeline is about to invoke. Useful before processing starts.
   */
  estimatedCostUsd: number
}

export interface IndexJob {
  id: string
  type: IndexJobType
  sourceType: 'file' | 'external_document' | 'thread_event' | 'pipeline_role'
  sourceId: string
  workspaceId: string
  priority: number // 1 (highest) to 5 (lowest)
  createdAt: Date
  /** When the job entered a terminal state (completed/failed/cancelled). */
  finishedAt?: Date
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  attempts: number
  lastError?: string
  metadata?: Record<string, unknown>
  progress: IndexProgress
  cancelRequested: boolean
  abortController: AbortController
  get abortSignal(): AbortSignal
}

// ─── Priority Mapping ─────────────────────────────────────────────────────

const JOB_PRIORITY: Record<IndexJobType, number> = {
  full_index: 1,
  incremental_index: 2,
  health_sweep: 5,
  // Pipeline-role jobs sit between full_index (user-driven) and health_sweep
  // (background) — they're scheduled but matter for retrieval freshness.
  archivist_run: 3,
  profiler_run: 4,
}

// ─── Queue State ──────────────────────────────────────────────────────────

const queue: IndexJob[] = []
const processing = new Set<string>()
let workerInterval: ReturnType<typeof setInterval> | null = null
let jobHandler: ((job: IndexJob) => Promise<void>) | null = null

const MAX_CONCURRENT = 2
const WORKER_INTERVAL_MS = 2000 // was 5000 — tighter polling → faster job pickup
const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 5000
const COMPLETION_RING_SIZE = 200 // last N completions, kept regardless of cleanup
const TERMINAL_TTL_MS = 10 * 60 * 1000 // prune from main `queue` array

// Ring buffer of recent terminal events. Each entry is the moment the job
// entered a terminal state. Used by /stats to compute throughput honestly,
// independent of `queue` cleanup based on creation time.
interface CompletionRecord {
  jobId: string
  finishedAt: number
  status: 'completed' | 'failed' | 'cancelled'
  /** Wall time spent processing (started → finished), ms. */
  durationMs: number
}
const completionRing: CompletionRecord[] = []

// Ring buffer of recent enqueue events (for measuring upload rate).
const enqueueRing: number[] = [] // timestamps
const ENQUEUE_RING_SIZE = 500

function recordCompletion(job: IndexJob, status: 'completed' | 'failed' | 'cancelled'): void {
  const now = Date.now()
  job.finishedAt = new Date(now)
  const startedMs = job.progress.startedAt ? job.progress.startedAt.getTime() : now
  completionRing.push({
    jobId: job.id,
    finishedAt: now,
    status,
    durationMs: Math.max(now - startedMs, 0),
  })
  if (completionRing.length > COMPLETION_RING_SIZE) completionRing.shift()
}

function recordEnqueue(): void {
  enqueueRing.push(Date.now())
  if (enqueueRing.length > ENQUEUE_RING_SIZE) enqueueRing.shift()
}

// ─── Event Bus (for dashboard WS fan-out) ─────────────────────────────────

export type IndexQueueEvent =
  | { type: 'job:enqueued'; job: IndexJob }
  | { type: 'job:started'; job: IndexJob }
  | { type: 'job:progress'; jobId: string; progress: IndexProgress }
  | { type: 'job:completed'; jobId: string; progress: IndexProgress }
  | { type: 'job:failed'; jobId: string; error: string; progress: IndexProgress }
  | { type: 'job:cancelled'; jobId: string; progress: IndexProgress }

export const indexQueueEvents = new EventEmitter()

function emit(event: IndexQueueEvent): void {
  try {
    indexQueueEvents.emit('event', event)
  } catch {
    /* never let listeners break the worker */
  }
}

// ─── Queue Operations ─────────────────────────────────────────────────────

let jobCounter = 0

function makeProgress(): IndexProgress {
  return {
    phase: 'queued',
    chunksTotal: 0,
    chunksDone: 0,
    msPerChunk: 0,
    etaMs: null,
    startedAt: null,
    phaseTimings: {},
    actualCostUsd: 0,
    estimatedCostUsd: 0,
  }
}

// ─── Folder Helpers ───────────────────────────────────────────────────────

/**
 * Derive a folder bucket for a job. Uses `metadata.folderPath` if present,
 * otherwise falls back to the dirname of `metadata.filePath`, otherwise the
 * catch-all "(uncategorized)" bucket. The value is used as a key across the
 * persistent state maps, so it has to be deterministic per source.
 */
export function getJobFolder(job: Pick<IndexJob, 'metadata'>): string {
  const folderPath = job.metadata?.['folderPath'] as string | undefined
  if (folderPath && folderPath.length > 0) return folderPath
  const filePath = job.metadata?.['filePath'] as string | undefined
  if (filePath && filePath.length > 0) {
    // Normalize slashes so "C:\a\b\c.md" and "C:/a/b/c.md" bucket identically.
    const normalized = filePath.replace(/\\/g, '/')
    const idx = normalized.lastIndexOf('/')
    if (idx > 0) return normalized.slice(0, idx)
  }
  return '(uncategorized)'
}

function toSnapshot(job: IndexJob): SnapshotJob {
  return {
    sourceId: job.sourceId,
    sourceType: job.sourceType,
    type: job.type,
    workspaceId: job.workspaceId,
    folderPath: getJobFolder(job),
    label: (job.metadata?.['label'] as string | undefined) ?? null,
  }
}

/**
 * Enqueue an indexing job. Deduplicates by sourceId + type.
 */
export function enqueueIndexJob(params: {
  type: IndexJobType
  sourceType: IndexJob['sourceType']
  sourceId: string
  workspaceId: string
  metadata?: Record<string, unknown>
}): IndexJob | null {
  // Dedup: skip if same sourceId + type is already pending/processing
  const existing = queue.find(
    (j) =>
      j.sourceId === params.sourceId &&
      j.type === params.type &&
      (j.status === 'pending' || j.status === 'processing')
  )
  if (existing) return null

  const abortController = new AbortController()

  const job: IndexJob = {
    id: `idx-${++jobCounter}-${Date.now()}`,
    type: params.type,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    workspaceId: params.workspaceId,
    priority: JOB_PRIORITY[params.type],
    createdAt: new Date(),
    status: 'pending',
    attempts: 0,
    metadata: params.metadata,
    progress: makeProgress(),
    cancelRequested: false,
    abortController,
    get abortSignal() {
      return this.abortController.signal
    },
  }

  queue.push(job)
  recordEnqueue()

  // Sort by priority (ascending = higher priority first)
  queue.sort((a, b) => a.priority - b.priority)

  emit({ type: 'job:enqueued', job })
  return job
}

// ─── Progress reporting helpers (called by indexing-agent) ────────────────

/**
 * Set the current phase and reset per-chunk rolling stats.
 */
export function setPhase(job: IndexJob, phase: IndexPhase, chunksTotal?: number): void {
  const now = Date.now()
  const previousPhase = job.progress.phase
  const phaseStart = phaseStartMap.get(job.id) ?? now

  // Close out previous phase timing
  if (previousPhase && previousPhase !== phase) {
    const elapsed = now - phaseStart
    job.progress.phaseTimings[previousPhase] =
      (job.progress.phaseTimings[previousPhase] ?? 0) + elapsed
  }

  phaseStartMap.set(job.id, now)
  // Keep chunk samples between phases: they're still useful for ETA seeding.
  // If the new phase behaves very differently, tickChunk will overwrite the
  // rolling window within ~12 chunks.

  job.progress.phase = phase
  if (typeof chunksTotal === 'number') {
    job.progress.chunksTotal = chunksTotal
    job.progress.chunksDone = 0
  }
  // Preserve msPerChunk + recompute etaMs against the new chunksTotal so the
  // UI doesn't flash "estimating…" every time we cross a phase boundary.
  if (job.progress.msPerChunk > 0 && job.progress.chunksTotal > 0) {
    job.progress.etaMs = job.progress.chunksTotal * job.progress.msPerChunk
  } else {
    job.progress.etaMs = null
  }
  emit({ type: 'job:progress', jobId: job.id, progress: { ...job.progress } })
}

/**
 * Record that one chunk of work finished. Accepts the wall time it took (ms).
 */
export function tickChunk(job: IndexJob, chunkMs: number): void {
  job.progress.chunksDone = Math.min(job.progress.chunksDone + 1, job.progress.chunksTotal || 1e9)

  // Rolling median over the last 12 chunk timings
  const samples = chunkSamplesMap.get(job.id) ?? []
  samples.push(chunkMs)
  while (samples.length > 12) samples.shift()
  chunkSamplesMap.set(job.id, samples)

  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0
  job.progress.msPerChunk = median
  const remaining = Math.max(job.progress.chunksTotal - job.progress.chunksDone, 0)
  job.progress.etaMs = remaining > 0 ? remaining * median : 0

  emit({ type: 'job:progress', jobId: job.id, progress: { ...job.progress } })
}

export function setMessage(job: IndexJob, message: string): void {
  job.progress.message = message
  emit({ type: 'job:progress', jobId: job.id, progress: { ...job.progress } })
}

const phaseStartMap = new Map<string, number>()
const chunkSamplesMap = new Map<string, number[]>()

// ─── Cancellation ─────────────────────────────────────────────────────────

export function cancelIndexJob(jobId: string): boolean {
  const job = queue.find((j) => j.id === jobId)
  if (!job) return false
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')
    return false
  job.cancelRequested = true
  try {
    job.abortController.abort()
  } catch {
    /* ignore */
  }
  // If still pending, mark cancelled immediately; processing jobs get cancelled on next checkpoint.
  if (job.status === 'pending') {
    job.status = 'cancelled'
    job.progress.phase = 'cancelled'
    recordCompletion(job, 'cancelled')
    emit({ type: 'job:cancelled', jobId: job.id, progress: { ...job.progress } })
  }
  return true
}

export function isCancelled(job: IndexJob): boolean {
  return job.cancelRequested
}

// ─── Processing ──────────────────────────────────────────────────────────

async function processNext(): Promise<void> {
  if (processing.size >= MAX_CONCURRENT) return
  if (!jobHandler) return

  // Skip jobs whose folder is paused/stopped so that one runaway folder can
  // be frozen without halting the rest of the queue.
  const nextJob = queue.find((j) => j.status === 'pending' && !isFolderBlocked(getJobFolder(j)))
  if (!nextJob) return

  nextJob.status = 'processing'
  nextJob.attempts++
  nextJob.progress.startedAt = new Date()
  nextJob.progress.phase = 'queued'
  processing.add(nextJob.id)
  phaseStartMap.set(nextJob.id, Date.now())

  emit({ type: 'job:started', job: nextJob })

  try {
    await jobHandler(nextJob)

    if (nextJob.cancelRequested) {
      nextJob.status = 'cancelled'
      nextJob.progress.phase = 'cancelled'
      recordCompletion(nextJob, 'cancelled')
      emit({ type: 'job:cancelled', jobId: nextJob.id, progress: { ...nextJob.progress } })
      console.info(`[IndexQueue] Job ${nextJob.id} (${nextJob.type}) cancelled`)
    } else {
      nextJob.status = 'completed'
      nextJob.progress.phase = 'done'
      nextJob.progress.chunksDone = nextJob.progress.chunksTotal
      nextJob.progress.etaMs = 0
      recordCompletion(nextJob, 'completed')
      emit({ type: 'job:completed', jobId: nextJob.id, progress: { ...nextJob.progress } })
      console.info(`[IndexQueue] Job ${nextJob.id} (${nextJob.type}) completed`)
    }
  } catch (error) {
    const err = error as Error
    nextJob.lastError = err.message

    if (nextJob.cancelRequested) {
      nextJob.status = 'cancelled'
      nextJob.progress.phase = 'cancelled'
      recordCompletion(nextJob, 'cancelled')
      emit({ type: 'job:cancelled', jobId: nextJob.id, progress: { ...nextJob.progress } })
    } else if (nextJob.attempts >= MAX_RETRIES) {
      nextJob.status = 'failed'
      nextJob.progress.phase = 'error'
      nextJob.progress.message = err.message
      recordCompletion(nextJob, 'failed')
      emit({
        type: 'job:failed',
        jobId: nextJob.id,
        error: err.message,
        progress: { ...nextJob.progress },
      })
      console.error(
        `[IndexQueue] Job ${nextJob.id} (${nextJob.type}) failed after ${MAX_RETRIES} retries:`,
        err.message
      )
    } else {
      // Re-queue with backoff (worker will pick it back up)
      nextJob.status = 'pending'
      nextJob.progress = makeProgress()
      // Fresh abort for the next attempt
      nextJob.abortController = new AbortController()
      const backoffMs = BACKOFF_BASE_MS * Math.pow(2, nextJob.attempts - 1)
      console.warn(
        `[IndexQueue] Job ${nextJob.id} retry ${nextJob.attempts}/${MAX_RETRIES} in ${backoffMs}ms`
      )
    }
  } finally {
    processing.delete(nextJob.id)
    chunkSamplesMap.delete(nextJob.id)
    phaseStartMap.delete(nextJob.id)
  }
}

// ─── Worker Lifecycle ─────────────────────────────────────────────────────

// ─── Pause / Resume / Stop / Jump-start ───────────────────────────────────
//
// Three pieces of state, all mirrored to disk so a server restart does NOT
// silently flip the worker back on:
//   • paused   — worker does not pick new jobs. In-flight jobs continue.
//   • stopped  — worker does not pick new jobs. Pending + processing jobs
//                are cancelled. The set of cancelled sourceIds is captured
//                in `stoppedSnapshot` so "jump start" can re-enqueue them.
//   • folderPaused / folderStopped / folderSnapshot — same semantics, but
//                scoped to a single folderPath bucket. A folder-scoped pause
//                does NOT halt other folders; the worker skips only the
//                matching jobs.
//
// The only persisted "intent" is those flags and the snapshot. Queue/job
// objects themselves are still in-memory and reconstructed on restart from
// the normal enqueue paths.

let queuePaused = false
let queueStopped = false
let stoppedSnapshot: SnapshotJob[] = []
const folderPaused = new Map<string, boolean>()
const folderStopped = new Map<string, boolean>()
const folderSnapshot = new Map<string, SnapshotJob[]>()
// Auto-index defaults on — the original UX for 4 sprints was "drop files,
// they get indexed". Flipping this off means uploads land in raw_files
// untouched and the user drives indexing manually.
let autoIndexEnabled = true

function currentState(): PersistedQueueState {
  return {
    paused: queuePaused,
    stopped: queueStopped,
    snapshot: stoppedSnapshot,
    folderPaused: Object.fromEntries(folderPaused),
    folderStopped: Object.fromEntries(folderStopped),
    folderSnapshot: Object.fromEntries(folderSnapshot),
    autoIndex: autoIndexEnabled,
  }
}

function persist(): void {
  void saveQueueState(currentState())
}

/**
 * Load the persisted pause/stop intent. Call once at boot *before* the
 * worker handler is registered so we don't accidentally process a single
 * job against a stale "running" assumption.
 */
export async function hydrateQueueState(): Promise<void> {
  const state = await loadQueueState()
  queuePaused = state.paused
  queueStopped = state.stopped
  stoppedSnapshot = state.snapshot ?? []
  folderPaused.clear()
  for (const [k, v] of Object.entries(state.folderPaused ?? {})) folderPaused.set(k, v)
  folderStopped.clear()
  for (const [k, v] of Object.entries(state.folderStopped ?? {})) folderStopped.set(k, v)
  folderSnapshot.clear()
  for (const [k, v] of Object.entries(state.folderSnapshot ?? {})) folderSnapshot.set(k, v)
  autoIndexEnabled = state.autoIndex !== false // default true when missing
  if (queuePaused || queueStopped || folderPaused.size > 0 || folderStopped.size > 0) {
    console.info(
      `[IndexQueue] Hydrated persisted intent — paused=${queuePaused} stopped=${queueStopped} folderPaused=${folderPaused.size} folderStopped=${folderStopped.size} autoIndex=${autoIndexEnabled}`
    )
  }
}

// ─── Auto-index toggle ────────────────────────────────────────────────────

export function isAutoIndexEnabled(): boolean {
  return autoIndexEnabled
}

export function setAutoIndexEnabled(enabled: boolean): void {
  autoIndexEnabled = !!enabled
  persist()
  console.info(`[IndexQueue] autoIndex=${autoIndexEnabled} (persisted)`)
}

export function pauseQueue(): void {
  queuePaused = true
  persist()
  console.info('[IndexQueue] Worker paused (persisted)')
}

export function resumeQueue(): void {
  queuePaused = false
  // Resuming clears the global stop too — the only way out of "stopped" is
  // either resume (discard snapshot) or jumpStartQueue (re-enqueue snapshot).
  queueStopped = false
  stoppedSnapshot = []
  persist()
  console.info('[IndexQueue] Worker resumed (persisted)')
}

export function isQueuePaused(): boolean {
  return queuePaused
}

export function isQueueStopped(): boolean {
  return queueStopped
}

/**
 * Stop everything: snapshot pending+processing source refs, cancel them,
 * flip the stopped flag. The worker stays stopped across restarts until
 * the user calls jumpStartQueue() or resumeQueue().
 */
export function stopQueue(): { cancelled: number; snapshotSize: number } {
  queueStopped = true
  queuePaused = true
  const snap: SnapshotJob[] = []
  let cancelled = 0
  for (const job of queue) {
    if (job.status === 'pending' || job.status === 'processing') {
      snap.push(toSnapshot(job))
      cancelIndexJob(job.id)
      cancelled++
    }
  }
  stoppedSnapshot = snap
  persist()
  console.info(`[IndexQueue] Worker stopped — ${cancelled} cancelled, ${snap.length} snapshotted`)
  return { cancelled, snapshotSize: snap.length }
}

/**
 * Jump-start: clear the stopped + paused flags and re-enqueue the snapshot
 * captured by the last stopQueue() call. Returns the number of jobs that
 * were actually re-enqueued (dedup may skip some that are already live).
 */
export function jumpStartQueue(): { requeued: number } {
  const snap = stoppedSnapshot
  stoppedSnapshot = []
  queueStopped = false
  queuePaused = false
  let requeued = 0
  for (const entry of snap) {
    const job = enqueueIndexJob({
      type: entry.type,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      workspaceId: entry.workspaceId,
      metadata: {
        folderPath: entry.folderPath ?? undefined,
        label: entry.label ?? undefined,
        jumpStarted: true,
      },
    })
    if (job) requeued++
  }
  persist()
  console.info(`[IndexQueue] Jump-start — requeued ${requeued}/${snap.length}`)
  return { requeued }
}

// ─── Folder-scoped controls ───────────────────────────────────────────────
//
// Folder scope is a SUBTREE, not an exact match. The user's mental model
// when they click "Stop indexing" on `C:/Dev/Workspace App` is "stop
// everything under here" — a job whose folder bucket is
// `C:/Dev/Workspace App/apps/web/src/components` must also be caught.
// Anything matching the folder exactly OR a descendant prefix gets the
// action applied.

function normalizeFolderKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function jobUnderFolder(job: IndexJob, targetNorm: string): boolean {
  if (!targetNorm) return true // empty target = whole queue
  const j = normalizeFolderKey(getJobFolder(job))
  return j === targetNorm || j.startsWith(targetNorm + '/')
}

function folderStateUnder(path: string): boolean {
  // A folder is considered blocked if IT or any ANCESTOR has been paused
  // or stopped. Without the ancestor check, pausing `apps/web` would still
  // let the worker pick up `apps/web/src/...` jobs.
  const n = normalizeFolderKey(path)
  for (const [key] of folderPaused) {
    const k = normalizeFolderKey(key)
    if (n === k || n.startsWith(k + '/')) return true
  }
  for (const [key] of folderStopped) {
    const k = normalizeFolderKey(key)
    if (n === k || n.startsWith(k + '/')) return true
  }
  return false
}

export function pauseFolder(folderPath: string): void {
  folderPaused.set(folderPath, true)
  persist()
  console.info(`[IndexQueue] Folder paused (subtree): ${folderPath}`)
}

export function resumeFolder(folderPath: string): void {
  // Resume is also subtree-scoped: unpausing `apps` should clear any
  // nested paused/stopped children that fell under it.
  const target = normalizeFolderKey(folderPath)
  const clear = (map: Map<string, unknown>) => {
    for (const key of Array.from(map.keys())) {
      const k = normalizeFolderKey(key)
      if (k === target || k.startsWith(target + '/')) map.delete(key)
    }
  }
  clear(folderPaused)
  clear(folderStopped)
  clear(folderSnapshot as unknown as Map<string, unknown>)
  persist()
  console.info(`[IndexQueue] Folder resumed (subtree): ${folderPath}`)
}

export function stopFolder(folderPath: string): { cancelled: number; snapshotSize: number } {
  folderStopped.set(folderPath, true)
  folderPaused.set(folderPath, true)
  const targetNorm = normalizeFolderKey(folderPath)
  const snap: SnapshotJob[] = []
  let cancelled = 0
  for (const job of queue) {
    if (!jobUnderFolder(job, targetNorm)) continue
    if (job.status === 'pending' || job.status === 'processing') {
      snap.push(toSnapshot(job))
      cancelIndexJob(job.id)
      cancelled++
    }
  }
  folderSnapshot.set(folderPath, snap)
  persist()
  console.info(
    `[IndexQueue] Folder stopped (subtree): ${folderPath} — ${cancelled} cancelled, ${snap.length} snapshotted`
  )
  return { cancelled, snapshotSize: snap.length }
}

export function jumpStartFolder(folderPath: string): { requeued: number } {
  const snap = folderSnapshot.get(folderPath) ?? []
  folderSnapshot.delete(folderPath)
  // Clear stopped/paused state across the subtree — same as resumeFolder.
  const target = normalizeFolderKey(folderPath)
  const clear = (map: Map<string, unknown>) => {
    for (const key of Array.from(map.keys())) {
      const k = normalizeFolderKey(key)
      if (k === target || k.startsWith(target + '/')) map.delete(key)
    }
  }
  clear(folderPaused)
  clear(folderStopped)
  let requeued = 0
  for (const entry of snap) {
    const job = enqueueIndexJob({
      type: entry.type,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      workspaceId: entry.workspaceId,
      metadata: {
        folderPath: entry.folderPath ?? folderPath,
        label: entry.label ?? undefined,
        jumpStarted: true,
      },
    })
    if (job) requeued++
  }
  persist()
  console.info(
    `[IndexQueue] Folder jump-start (subtree): ${folderPath} — requeued ${requeued}/${snap.length}`
  )
  return { requeued }
}

export function isFolderBlocked(folderPath: string): boolean {
  return folderStateUnder(folderPath)
}

export interface FolderControlState {
  folderPath: string
  paused: boolean
  stopped: boolean
  snapshotSize: number
}

export function listFolderControls(): FolderControlState[] {
  const paths = new Set<string>([
    ...folderPaused.keys(),
    ...folderStopped.keys(),
    ...folderSnapshot.keys(),
  ])
  return Array.from(paths).map((folderPath) => ({
    folderPath,
    paused: folderPaused.get(folderPath) === true,
    stopped: folderStopped.get(folderPath) === true,
    snapshotSize: folderSnapshot.get(folderPath)?.length ?? 0,
  }))
}

export function getGlobalControlSnapshotSize(): number {
  return stoppedSnapshot.length
}

// ─── Cost accumulation ───────────────────────────────────────────────────

/**
 * Called by the indexing agent whenever it bills an LLM or embedding call.
 * We track actual USD here (vs the estimate set at enqueue time) so the
 * dashboard can show live spend per job / per folder and users can stop a
 * runaway folder before the bill climbs further.
 */
export function addJobCost(job: IndexJob, costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return
  job.progress.actualCostUsd = Number((job.progress.actualCostUsd + costUsd).toFixed(6))
  emit({ type: 'job:progress', jobId: job.id, progress: { ...job.progress } })
}

export function setEstimatedCost(job: IndexJob, costUsd: number): void {
  job.progress.estimatedCostUsd = Number(costUsd.toFixed(6))
  emit({ type: 'job:progress', jobId: job.id, progress: { ...job.progress } })
}

// ─── Worker Lifecycle ─────────────────────────────────────────────────────

export function startIndexWorker(handler: (job: IndexJob) => Promise<void>): void {
  if (workerInterval) return
  jobHandler = handler

  workerInterval = setInterval(async () => {
    // Clean terminal jobs from the queue array based on FINISH time, not
    // creation time. Old enqueueing should not cause a just-finished job to
    // disappear before stats can see it.
    const cutoff = Date.now() - TERMINAL_TTL_MS
    for (let i = queue.length - 1; i >= 0; i--) {
      const j = queue[i]!
      const isTerminal =
        j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled'
      if (isTerminal && j.finishedAt && j.finishedAt.getTime() < cutoff) {
        queue.splice(i, 1)
      }
    }

    if (queuePaused || queueStopped) return

    // Process pending jobs up to concurrency limit
    while (processing.size < MAX_CONCURRENT) {
      const hasPending = queue.some(
        (j) => j.status === 'pending' && !isFolderBlocked(getJobFolder(j))
      )
      if (!hasPending) break
      await processNext()
    }
  }, WORKER_INTERVAL_MS)

  console.info('[IndexQueue] Worker started')
}

export function stopIndexWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
  }
  jobHandler = null
  console.info('[IndexQueue] Worker stopped')
}

// ─── Read API ─────────────────────────────────────────────────────────────

export interface QueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  total: number
  paused: boolean
  stopped: boolean
  /** How many jobs are held in the stop-snapshot (available for jump-start). */
  stoppedSnapshotSize: number
  /** Global auto-index toggle — when false, uploads don't auto-enqueue. */
  autoIndex: boolean
  /** Sum of actualCostUsd across all jobs still visible in the queue. */
  spentUsd: number
  /** Sum of estimatedCostUsd for pending + processing jobs. */
  estimatedRemainingUsd: number
  /** Completions in the last 60s (from ring buffer; survives queue cleanup). */
  completedLastMin: number
  /** Completions in the last 5 minutes. */
  completedLast5Min: number
  /** Mean wall-clock duration (ms) over the last 50 completed jobs. */
  avgJobDurationMs: number
  /** Median wall-clock duration (ms) over the last 50 completed jobs. */
  medianJobDurationMs: number
  /** Jobs enqueued in the last 60s. */
  enqueuedLastMin: number
  /** Jobs enqueued in the last 5 min. */
  enqueuedLast5Min: number
  /** Throughput jobs/sec, computed over a window of completion ring entries. */
  throughputJobsPerSec: number
  /** Net change in pending: positive = falling behind, negative = catching up. */
  netPendingChangePerSec: number
}

export function getQueueStats(): QueueStats {
  const now = Date.now()
  const oneMin = now - 60_000
  const fiveMin = now - 5 * 60_000

  const completedRecent = completionRing.filter((c) => c.status === 'completed')
  const completedLastMin = completedRecent.filter((c) => c.finishedAt > oneMin).length
  const completedLast5Min = completedRecent.filter((c) => c.finishedAt > fiveMin).length
  const enqueuedLastMin = enqueueRing.filter((t) => t > oneMin).length
  const enqueuedLast5Min = enqueueRing.filter((t) => t > fiveMin).length

  // Throughput from the last 50 completions: total work / wall-clock span.
  // This naturally smooths out big-file outliers without hand-tuned windows.
  const lastN = completedRecent.slice(-50)
  let throughputJobsPerSec = 0
  let avgJobDurationMs = 0
  let medianJobDurationMs = 0
  if (lastN.length >= 2) {
    const span = (lastN[lastN.length - 1]!.finishedAt - lastN[0]!.finishedAt) / 1000
    if (span > 0) throughputJobsPerSec = (lastN.length - 1) / span
    const durations = lastN.map((c) => c.durationMs)
    avgJobDurationMs = durations.reduce((s, v) => s + v, 0) / durations.length
    const sorted = [...durations].sort((a, b) => a - b)
    medianJobDurationMs = sorted[Math.floor(sorted.length / 2)]!
  } else if (lastN.length === 1) {
    avgJobDurationMs = lastN[0]!.durationMs
    medianJobDurationMs = lastN[0]!.durationMs
    if (lastN[0]!.durationMs > 0)
      throughputJobsPerSec = (1000 / lastN[0]!.durationMs) * MAX_CONCURRENT
  }

  // Net change rate: enqueue rate − completion rate over the last minute.
  const netPendingChangePerSec = (enqueuedLastMin - completedLastMin) / 60

  let spentUsd = 0
  let estimatedRemainingUsd = 0
  for (const j of queue) {
    spentUsd += j.progress.actualCostUsd ?? 0
    if (j.status === 'pending' || j.status === 'processing') {
      estimatedRemainingUsd += j.progress.estimatedCostUsd ?? 0
    }
  }

  return {
    pending: queue.filter((j) => j.status === 'pending').length,
    processing: queue.filter((j) => j.status === 'processing').length,
    completed: queue.filter((j) => j.status === 'completed').length,
    failed: queue.filter((j) => j.status === 'failed').length,
    cancelled: queue.filter((j) => j.status === 'cancelled').length,
    total: queue.length,
    paused: queuePaused,
    stopped: queueStopped,
    stoppedSnapshotSize: stoppedSnapshot.length,
    autoIndex: autoIndexEnabled,
    spentUsd: Number(spentUsd.toFixed(4)),
    estimatedRemainingUsd: Number(estimatedRemainingUsd.toFixed(4)),
    completedLastMin,
    completedLast5Min,
    avgJobDurationMs: Math.round(avgJobDurationMs),
    medianJobDurationMs: Math.round(medianJobDurationMs),
    enqueuedLastMin,
    enqueuedLast5Min,
    throughputJobsPerSec: Number(throughputJobsPerSec.toFixed(3)),
    netPendingChangePerSec: Number(netPendingChangePerSec.toFixed(3)),
  }
}

export interface PublicIndexJob {
  id: string
  type: IndexJobType
  sourceType: IndexJob['sourceType']
  sourceId: string
  workspaceId: string
  status: IndexJob['status']
  attempts: number
  createdAt: string
  lastError?: string
  progress: IndexProgress
  /** File name / metadata label if available. */
  label?: string
  /** Folder bucket this job is grouped under. See getJobFolder(). */
  folderPath: string
  /** Full file path if the source is a watched/local file. */
  filePath?: string
}

function toPublic(job: IndexJob): PublicIndexJob {
  return {
    id: job.id,
    type: job.type,
    sourceType: job.sourceType,
    sourceId: job.sourceId,
    workspaceId: job.workspaceId,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt.toISOString(),
    lastError: job.lastError,
    progress: {
      ...job.progress,
      startedAt: job.progress.startedAt,
    },
    label:
      (job.metadata?.['label'] as string | undefined) ??
      (job.metadata?.['fileName'] as string | undefined),
    folderPath: getJobFolder(job),
    filePath: job.metadata?.['filePath'] as string | undefined,
  }
}

export function listJobs(opts?: {
  limit?: number
  statuses?: IndexJob['status'][]
}): PublicIndexJob[] {
  const statuses = opts?.statuses
  const limit = opts?.limit ?? 50
  const filtered = statuses ? queue.filter((j) => statuses.includes(j.status)) : queue
  return filtered
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(toPublic)
}

export function getJob(jobId: string): PublicIndexJob | null {
  const job = queue.find((j) => j.id === jobId)
  return job ? toPublic(job) : null
}

/**
 * Look up the most recent job for each of the given source ids. Used by the
 * per-file status badge in ItemsView: we want the newest known state (active
 * or terminal) for each fileId. Returns a map keyed by sourceId.
 */
/**
 * Aggregate the visible queue by folderPath. Used by the dashboard Sources
 * tab so a 5000-file re-index run can be surveyed and controlled per-folder
 * rather than as one opaque stream.
 */
export interface SourceFolderSummary {
  folderPath: string
  files: number
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  spentUsd: number
  estimatedRemainingUsd: number
  paused: boolean
  stopped: boolean
  snapshotSize: number
  /** Most recent createdAt in the group, for sorting. */
  lastActivityAt: string | null
}

export function listSources(): SourceFolderSummary[] {
  const groups = new Map<string, SourceFolderSummary>()
  const seenSourceIds = new Map<string, Set<string>>()

  const ensure = (folder: string): SourceFolderSummary => {
    let g = groups.get(folder)
    if (!g) {
      g = {
        folderPath: folder,
        files: 0,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        spentUsd: 0,
        estimatedRemainingUsd: 0,
        paused: folderPaused.get(folder) === true,
        stopped: folderStopped.get(folder) === true,
        snapshotSize: folderSnapshot.get(folder)?.length ?? 0,
        lastActivityAt: null,
      }
      groups.set(folder, g)
      seenSourceIds.set(folder, new Set())
    }
    return g
  }

  for (const job of queue) {
    const folder = getJobFolder(job)
    const g = ensure(folder)
    const seen = seenSourceIds.get(folder)!
    if (!seen.has(job.sourceId)) {
      seen.add(job.sourceId)
      g.files++
    }
    if (job.status === 'pending') g.pending++
    else if (job.status === 'processing') g.processing++
    else if (job.status === 'completed') g.completed++
    else if (job.status === 'failed') g.failed++
    else if (job.status === 'cancelled') g.cancelled++
    g.spentUsd = Number((g.spentUsd + (job.progress.actualCostUsd ?? 0)).toFixed(6))
    if (job.status === 'pending' || job.status === 'processing') {
      g.estimatedRemainingUsd = Number(
        (g.estimatedRemainingUsd + (job.progress.estimatedCostUsd ?? 0)).toFixed(6)
      )
    }
    const ts = job.createdAt.toISOString()
    if (!g.lastActivityAt || ts > g.lastActivityAt) g.lastActivityAt = ts
  }

  // Folders that have no live jobs but still carry persisted intent (e.g. a
  // folder the user stopped yesterday) should still appear, so the user can
  // jump-start from the UI.
  for (const folder of new Set([
    ...folderPaused.keys(),
    ...folderStopped.keys(),
    ...folderSnapshot.keys(),
  ])) {
    ensure(folder)
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.lastActivityAt && b.lastActivityAt)
      return b.lastActivityAt.localeCompare(a.lastActivityAt)
    if (a.lastActivityAt) return -1
    if (b.lastActivityAt) return 1
    return a.folderPath.localeCompare(b.folderPath)
  })
}

/**
 * Jobs scoped to one folder bucket. Used by the folder detail page.
 */
export function listJobsByFolder(folderPath: string, limit = 200): PublicIndexJob[] {
  return queue
    .filter((j) => getJobFolder(j) === folderPath)
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(toPublic)
}

export function getJobsBySourceIds(sourceIds: string[]): Record<string, PublicIndexJob> {
  const wanted = new Set(sourceIds)
  const out: Record<string, PublicIndexJob> = {}
  // Iterate newest-first so the first match per sourceId wins.
  const sorted = queue.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  for (const job of sorted) {
    if (!wanted.has(job.sourceId)) continue
    if (out[job.sourceId]) continue
    out[job.sourceId] = toPublic(job)
  }
  return out
}
