/**
 * Queue-state persistence.
 *
 * Stores pause/stop intent + snapshot of pending work so the worker does not
 * silently auto-resume after a server restart. The original in-memory flag
 * reset to `false` on boot, which is how a $10+ indexing run escaped a pause.
 */
import { promises as fs, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

export interface SnapshotJob {
  sourceId: string
  sourceType: 'file' | 'external_document' | 'thread_event' | 'pipeline_role'
  type:
    | 'full_index'
    | 'incremental_index'
    | 'health_sweep'
    | 'archivist_run'
    | 'profiler_run'
  workspaceId: string
  folderPath: string | null
  label: string | null
}

export interface PersistedQueueState {
  paused: boolean
  stopped: boolean
  /** Jobs pending/processing at the moment `stop` was called. */
  snapshot: SnapshotJob[]
  /** Per-folder intent, keyed by folderPath. */
  folderPaused: Record<string, boolean>
  folderStopped: Record<string, boolean>
  folderSnapshot: Record<string, SnapshotJob[]>
  /**
   * When false, `queueFileIndex()` won't auto-enqueue on upload — the user
   * has to trigger indexing explicitly (per-file Index button, or the
   * Add-to-Index modal). Default true to preserve pre-existing behavior.
   */
  autoIndex: boolean
}

const STATE_PATH = resolve(process.cwd(), 'data', 'queue-state.json')

const DEFAULT: PersistedQueueState = {
  paused: false,
  stopped: false,
  snapshot: [],
  folderPaused: {},
  folderStopped: {},
  folderSnapshot: {},
  autoIndex: true,
}

let writeChain: Promise<void> = Promise.resolve()

export async function loadQueueState(): Promise<PersistedQueueState> {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedQueueState>
    return { ...DEFAULT, ...parsed }
  } catch {
    return { ...DEFAULT }
  }
}

/**
 * Serialize writes so two rapid control clicks (pause + stop) can't race and
 * corrupt the file.
 */
export function saveQueueState(state: PersistedQueueState): Promise<void> {
  writeChain = writeChain.then(async () => {
    try {
      const dir = dirname(STATE_PATH)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
    } catch (err) {
      console.warn('[QueueState] Failed to persist:', (err as Error).message)
    }
  })
  return writeChain
}
