import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock chokidar
const mockWatcher = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn(),
}

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => mockWatcher),
  },
}))

// Mock fs.statSync
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    statSync: vi.fn(() => ({ size: 1000 })),
  }
})

import chokidar from 'chokidar'
import { startWatcher } from '../watcher.js'
import type { AgentConfig } from '../config.js'

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

const mockConfig: AgentConfig = {
  apiUrl: 'http://localhost:3001',
  apiKey: 'test-key',
  workspaceId: 'ws-001',
  folders: [
    {
      path: '/test/project',
      preset: 'open',
      recursive: true,
      includePatterns: ['**/*.ts'],
      excludePatterns: ['dist/**'],
    },
  ],
  syncIntervalMs: 5000,
  maxFileSizeMb: 50,
  logLevel: 'info',
}

describe('Watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWatcher.on.mockReturnThis()
  })

  it('creates a watcher for each folder', () => {
    const onChange = vi.fn()
    const watchers = startWatcher(mockConfig, onChange, mockLogger)

    expect(chokidar.watch).toHaveBeenCalledTimes(1)
    expect(watchers).toHaveLength(1)
  })

  it('registers event handlers', () => {
    const onChange = vi.fn()
    startWatcher(mockConfig, onChange, mockLogger)

    const registeredEvents = mockWatcher.on.mock.calls.map((call: unknown[]) => call[0])
    expect(registeredEvents).toContain('add')
    expect(registeredEvents).toContain('change')
    expect(registeredEvents).toContain('unlink')
    expect(registeredEvents).toContain('ready')
    expect(registeredEvents).toContain('error')
  })

  it('passes include patterns to chokidar', () => {
    const onChange = vi.fn()
    startWatcher(mockConfig, onChange, mockLogger)

    const watchArg = (chokidar.watch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(watchArg).toBeDefined()
    // With includePatterns, should build path-specific patterns
    expect(Array.isArray(watchArg) || typeof watchArg === 'string').toBe(true)
  })

  it('uses merged exclude patterns', () => {
    const onChange = vi.fn()
    startWatcher(mockConfig, onChange, mockLogger)

    const options = (chokidar.watch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    expect(options?.ignored).toContain('node_modules/**')
    expect(options?.ignored).toContain('.git/**')
    expect(options?.ignored).toContain('dist/**')
  })

  it('sets awaitWriteFinish for stability', () => {
    const onChange = vi.fn()
    startWatcher(mockConfig, onChange, mockLogger)

    const options = (chokidar.watch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    expect(options?.awaitWriteFinish).toBeDefined()
    expect(options?.awaitWriteFinish?.stabilityThreshold).toBe(1000)
  })
})
