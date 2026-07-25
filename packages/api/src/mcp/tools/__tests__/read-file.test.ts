import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Boundary, ScopeConflict } from '../../../services/scope/types'

// Hoisted mocks — must be declared before the module imports that consume them.
const {
  mockResolve,
  mockSummarize,
  mockGetRawFile,
  mockGetRawFileByName,
} = vi.hoisted(() => ({
  mockResolve: vi.fn<
    (params: unknown) => Promise<{ boundaries: Boundary[]; conflicts: ScopeConflict[] }>
  >(),
  mockSummarize: vi.fn<(conflicts: ScopeConflict[]) => string>(),
  mockGetRawFile: vi.fn(),
  mockGetRawFileByName: vi.fn(),
}))

vi.mock('../../../services/scope', () => ({
  resolveEffectiveBoundaries: mockResolve,
  summarizeConflictsForResponse: mockSummarize,
}))

vi.mock('../../../services/raw-file-store', () => ({
  getRawFile: mockGetRawFile,
  getRawFileByName: mockGetRawFileByName,
  repairRawFileMime: vi.fn(async (r: unknown) => r),
}))

vi.mock('../../../db/index', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
  },
}))

import { readFileTool } from '../read-file'

function session(overrides: Record<string, unknown> = {}): any {
  return {
    userId: 'user-1',
    workspaceId: 'ws-1',
    activeProjectId: null,
    activeProjectScope: 'personal',
    connectedAt: new Date(),
    lastActivityAt: new Date(),
    clientName: 'test',
    transport: 'sse',
    toolCalls: {},
    ...overrides,
  }
}

describe('read_file governance (GOVERNANCE-AUDIT-FIX-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSummarize.mockImplementation((conflicts) =>
      conflicts.length === 0
        ? ''
        : '\n\n[SCOPE CONFLICTS]\n' + conflicts.map((c) => `- ${c.resolution.reason}`).join('\n')
    )
  })

  it('no-boundary case: returns file normally (regression check)', async () => {
    mockResolve.mockResolvedValue({ boundaries: [], conflicts: [] })
    mockGetRawFile.mockResolvedValue({
      record: {
        id: 'file-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        fileSize: 12,
        contentHash: 'abc123def456',
        version: 1,
        extractedText: 'hello world',
        updatedAt: new Date('2026-04-15'),
      },
      content: Buffer.from('hello world'),
    })
    const res = await readFileTool.handler({ file_id: 'file-1' }, session(), { db: null })
    expect(res.isError).toBeFalsy()
    const text = res.content[0]!.text
    expect(text).toContain('notes.txt')
    expect(text).toContain('hello world')
    expect(text).not.toContain('SCOPE CONFLICTS')
  })

  it('governance-blocked case: early returns with conflict trailer, no file content', async () => {
    mockResolve.mockResolvedValue({
      boundaries: [],
      conflicts: [
        {
          type: 'vs_governance',
          boundaries: [],
          governance: { rule: 'index_access_denied', severity: 'hard' },
          resolution: {
            action: 'request_access',
            reason: "You don't have access to index 'private-1'.",
            next_step: 'Request access from owner.',
          },
        },
      ],
    })
    const res = await readFileTool.handler({ file_id: 'file-1' }, session(), { db: null })
    const text = res.content[0]!.text
    expect(text).toContain('[READ_FILE BLOCKED]')
    expect(text).toContain("index 'private-1'")
    // No raw-file content should leak
    expect(text).not.toContain('hello world')
    expect(mockGetRawFile).not.toHaveBeenCalled()
  })

  it('fail-closed case: boundary on dimension file lacks (edge_type) drops the file', async () => {
    const edgeBoundary: Boundary = {
      dimension: 'edge_type',
      op: 'include',
      value: 'contradicts',
    }
    mockResolve.mockResolvedValue({ boundaries: [edgeBoundary], conflicts: [] })
    mockGetRawFile.mockResolvedValue({
      record: {
        id: 'file-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        fileSize: 12,
        contentHash: 'abc',
        version: 1,
        extractedText: 'hello world',
        updatedAt: new Date(),
      },
      content: Buffer.from('hello world'),
    })
    const res = await readFileTool.handler({ file_id: 'file-1' }, session(), { db: null })
    const text = res.content[0]!.text
    expect(text).toContain('No file matching your scope found')
    expect(text).not.toContain('hello world')
  })

  it('governance-pass case: boundary satisfied by file metadata', async () => {
    const contributorBoundary: Boundary = {
      dimension: 'contributor',
      op: 'include',
      value: 'user-1',
    }
    mockResolve.mockResolvedValue({ boundaries: [contributorBoundary], conflicts: [] })
    mockGetRawFile.mockResolvedValue({
      record: {
        id: 'file-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        fileSize: 12,
        contentHash: 'abc',
        version: 1,
        extractedText: 'hello world',
        updatedAt: new Date(),
      },
      content: Buffer.from('hello world'),
    })
    const res = await readFileTool.handler({ file_id: 'file-1' }, session(), { db: null })
    const text = res.content[0]!.text
    expect(text).toContain('hello world')
  })

  it('requires file_name or file_id', async () => {
    mockResolve.mockResolvedValue({ boundaries: [], conflicts: [] })
    const res = await readFileTool.handler({}, session(), { db: null })
    expect(res.isError).toBe(true)
  })
})
