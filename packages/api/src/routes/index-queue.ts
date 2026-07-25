/**
 * Index Queue Router — inspect + control the in-memory indexing queue.
 *
 * GET    /api/index-queue/stats                            → aggregate stats
 * GET    /api/index-queue/jobs                             → list jobs
 * GET    /api/index-queue/jobs/:id                         → single job
 * POST   /api/index-queue/jobs/:id/cancel                  → cancel one job
 *
 * Global controls (persisted across restarts):
 * POST   /api/index-queue/pause                            → halt new pickups
 * POST   /api/index-queue/resume                           → clear pause + stop
 * POST   /api/index-queue/stop                             → cancel all, snapshot
 * POST   /api/index-queue/jump-start                       → re-enqueue snapshot
 * GET    /api/index-queue/control                          → current flags
 *
 * Per-folder drill-down:
 * GET    /api/index-queue/sources                          → folder summary list
 * GET    /api/index-queue/folder/jobs?folderPath=...       → jobs in folder (subtree)
 * POST   /api/index-queue/folder/:action                   → body: { folderPath }
 *                                                            action: pause|resume|stop|jump-start
 */
import { Hono } from 'hono'
import {
  getQueueStats,
  listJobs,
  getJob,
  cancelIndexJob,
  pauseQueue,
  resumeQueue,
  stopQueue,
  jumpStartQueue,
  isQueuePaused,
  isQueueStopped,
  getGlobalControlSnapshotSize,
  listSources,
  listJobsByFolder,
  pauseFolder,
  resumeFolder,
  stopFolder,
  jumpStartFolder,
  isAutoIndexEnabled,
  setAutoIndexEnabled,
} from '../services/indexing/index-queue'
import { dashboardTokenOrAuth } from '../middleware/dashboard-token'
import { authMiddleware } from './../middleware/auth'

/**
 * Queue-control endpoints must be callable from both:
 *   1. Dev console on :4000 (passes X-Dashboard-Token)
 *   2. Web app on :3009 (passes x-user-id / session cookies)
 * So we gate them with a middleware that accepts EITHER.
 */
const queueControlAuth = dashboardTokenOrAuth(authMiddleware)

export const indexQueueRouter = new Hono()

indexQueueRouter.get('/stats', (c) => {
  return c.json({ data: getQueueStats(), error: null })
})

indexQueueRouter.get('/jobs', (c) => {
  const limit = parseInt(c.req.query('limit') ?? '50', 10)
  const statusParam = c.req.query('status')
  const statuses = statusParam
    ? (statusParam.split(',').map((s) => s.trim()).filter(Boolean) as Array<
        'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
      >)
    : undefined
  return c.json({ data: listJobs({ limit, statuses }), error: null })
})

indexQueueRouter.get('/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'))
  if (!job) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Job not found' } },
      404
    )
  }
  return c.json({ data: job, error: null })
})

indexQueueRouter.post('/jobs/:id/cancel', queueControlAuth, (c) => {
  const ok = cancelIndexJob(c.req.param('id'))
  if (!ok) {
    return c.json(
      { data: null, error: { code: 'NOT_CANCELLABLE', message: 'Job not found or already finished' } },
      409
    )
  }
  return c.json({ data: { ok: true }, error: null })
})

// ─── Global queue-level controls ──────────────────────────────────────────

indexQueueRouter.post('/pause', queueControlAuth, (c) => {
  pauseQueue()
  return c.json({ data: { paused: true }, error: null })
})

indexQueueRouter.post('/resume', queueControlAuth, (c) => {
  resumeQueue()
  return c.json({ data: { paused: false, stopped: false }, error: null })
})

/**
 * Stop everything: snapshot pending/processing sources, cancel them, and
 * stay stopped across restarts until /jump-start or /resume is called.
 */
indexQueueRouter.post('/stop', queueControlAuth, (c) => {
  const result = stopQueue()
  return c.json({
    data: { paused: true, stopped: true, cancelled: result.cancelled, snapshotSize: result.snapshotSize },
    error: null,
  })
})

/**
 * Jump-start: re-enqueue the snapshot captured by the most recent /stop and
 * clear the stopped flag. No-op if no snapshot is present.
 */
indexQueueRouter.post('/jump-start', queueControlAuth, (c) => {
  const result = jumpStartQueue()
  return c.json({ data: { requeued: result.requeued, stopped: false, paused: false }, error: null })
})

indexQueueRouter.get('/control', (c) => {
  return c.json({
    data: {
      paused: isQueuePaused(),
      stopped: isQueueStopped(),
      snapshotSize: getGlobalControlSnapshotSize(),
      autoIndex: isAutoIndexEnabled(),
    },
    error: null,
  })
})

// ─── Auto-index toggle ────────────────────────────────────────────────────
// When auto-index is OFF, `queueFileIndex()` becomes a no-op on upload
// paths — the user drives indexing manually via Add-to-Index or the
// per-file "Index now" button. Explicit routes still bypass the gate.

indexQueueRouter.get('/auto-index', (c) => {
  return c.json({ data: { enabled: isAutoIndexEnabled() }, error: null })
})

indexQueueRouter.post('/auto-index', queueControlAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as { enabled?: boolean } | null
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'enabled (boolean) required' } },
      400
    )
  }
  setAutoIndexEnabled(body.enabled)
  return c.json({ data: { enabled: body.enabled }, error: null })
})

// ─── Per-folder drill-down ────────────────────────────────────────────────

indexQueueRouter.get('/sources', (c) => {
  return c.json({ data: listSources(), error: null })
})

/**
 * Folder path goes in the query string (GET) or request body (POST) — NOT
 * in the URL path. Earlier design embedded it as a multi-segment param but
 * Hono's router was 404ing on percent-encoded slashes inside the segment,
 * which surfaced as a mysterious "Indexing server returned 404" in the UI.
 */
indexQueueRouter.get('/folder/jobs', (c) => {
  const folderPath = c.req.query('folderPath') ?? ''
  if (!folderPath) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'folderPath query required' } },
      400
    )
  }
  const limit = parseInt(c.req.query('limit') ?? '200', 10)
  return c.json({ data: listJobsByFolder(folderPath, limit), error: null })
})

indexQueueRouter.post('/folder/:action', queueControlAuth, async (c) => {
  const action = c.req.param('action')
  const body = await c.req.json().catch(() => null) as { folderPath?: string } | null
  const folderPath = body?.folderPath
  if (!folderPath || typeof folderPath !== 'string') {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'folderPath (string) required in body' } },
      400
    )
  }
  switch (action) {
    case 'pause':
      pauseFolder(folderPath)
      return c.json({ data: { folderPath, paused: true }, error: null })
    case 'resume':
      resumeFolder(folderPath)
      return c.json({ data: { folderPath, paused: false, stopped: false }, error: null })
    case 'stop': {
      const result = stopFolder(folderPath)
      return c.json({
        data: { folderPath, stopped: true, cancelled: result.cancelled, snapshotSize: result.snapshotSize },
        error: null,
      })
    }
    case 'jump-start': {
      const result = jumpStartFolder(folderPath)
      return c.json({ data: { folderPath, requeued: result.requeued }, error: null })
    }
    default:
      return c.json(
        { data: null, error: { code: 'BAD_ACTION', message: `Unknown action: ${action}` } },
        400
      )
  }
})
