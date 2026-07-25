import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSyncQueue } from '../queue.js'
import type { AgentConfig, WatchFolder } from '../config.js'
import type { Syncer, FileChangeEvent } from '../syncer.js'

const openFolder: WatchFolder = {
  path: '/test',
  preset: 'open',
  recursive: true,
}

const balancedFolder: WatchFolder = {
  path: '/test-balanced',
  preset: 'balanced',
  recursive: true,
}

const privateFolder: WatchFolder = {
  path: '/test-private',
  preset: 'private',
  recursive: true,
}

const mockConfig: AgentConfig = {
  apiUrl: 'http://localhost:3001',
  apiKey: 'test-key',
  workspaceId: 'ws-001',
  folders: [openFolder],
  syncIntervalMs: 1000,
  maxFileSizeMb: 50,
  logLevel: 'error',
}

function createMockSyncer(): Syncer {
  return {
    syncFile: vi.fn().mockResolvedValue({ fileName: 'test.ts', status: 'uploaded', hash: 'abc' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    checkConnection: vi.fn().mockResolvedValue(true),
  }
}

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

describe('Sync Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates by filePath (latest event wins)', async () => {
    const syncer = createMockSyncer()
    const queue = createSyncQueue(mockConfig, syncer, mockLogger)

    queue.enqueue({ type: 'add', filePath: '/test/a.ts', folderConfig: openFolder, detectedAt: new Date() })
    queue.enqueue({ type: 'change', filePath: '/test/a.ts', folderConfig: openFolder, detectedAt: new Date() })

    expect(queue.pending()).toBe(1)

    const result = await queue.flush()
    expect(syncer.syncFile).toHaveBeenCalledTimes(1)
    expect(result.uploaded).toBe(1)
  })

  it('processes open preset files immediately', async () => {
    const syncer = createMockSyncer()
    const queue = createSyncQueue(mockConfig, syncer, mockLogger)

    queue.enqueue({ type: 'add', filePath: '/test/a.ts', folderConfig: openFolder, detectedAt: new Date() })
    const result = await queue.flush()

    expect(syncer.syncFile).toHaveBeenCalledTimes(1)
    expect(result.uploaded).toBe(1)
  })

  it('logs but does not sync balanced preset files', async () => {
    const syncer = createMockSyncer()
    const queue = createSyncQueue(mockConfig, syncer, mockLogger)

    queue.enqueue({ type: 'add', filePath: '/test-balanced/a.ts', folderConfig: balancedFolder, detectedAt: new Date() })
    const result = await queue.flush()

    expect(syncer.syncFile).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalled()
  })

  it('skips private preset files', async () => {
    const syncer = createMockSyncer()
    const queue = createSyncQueue(mockConfig, syncer, mockLogger)

    queue.enqueue({ type: 'add', filePath: '/test-private/a.ts', folderConfig: privateFolder, detectedAt: new Date() })
    const result = await queue.flush()

    expect(syncer.syncFile).not.toHaveBeenCalled()
  })

  it('handles unlink events', async () => {
    const syncer = createMockSyncer()
    const queue = createSyncQueue(mockConfig, syncer, mockLogger)

    queue.enqueue({ type: 'unlink', filePath: '/test/a.ts', folderConfig: openFolder, detectedAt: new Date() })
    const result = await queue.flush()

    expect(syncer.deleteFile).toHaveBeenCalledWith('/test/a.ts')
    expect(result.deleted).toBe(1)
  })

  it('tracks pending count correctly', () => {
    const syncer = createMockSyncer()
    const queue = createSyncQueue(mockConfig, syncer, mockLogger)

    expect(queue.pending()).toBe(0)
    queue.enqueue({ type: 'add', filePath: '/test/a.ts', folderConfig: openFolder, detectedAt: new Date() })
    expect(queue.pending()).toBe(1)
    queue.enqueue({ type: 'add', filePath: '/test/b.ts', folderConfig: openFolder, detectedAt: new Date() })
    expect(queue.pending()).toBe(2)
  })

  it('counts unchanged files', async () => {
    const syncer = createMockSyncer()
    ;(syncer.syncFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      fileName: 'test.ts',
      status: 'unchanged',
      hash: 'abc',
    })
    const queue = createSyncQueue(mockConfig, syncer, mockLogger)

    queue.enqueue({ type: 'add', filePath: '/test/a.ts', folderConfig: openFolder, detectedAt: new Date() })
    const result = await queue.flush()
    expect(result.unchanged).toBe(1)
  })
})
