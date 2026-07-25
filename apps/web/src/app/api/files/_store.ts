// Shared in-memory file store for standalone demo mode (no backend needed)
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

export interface MockFile {
  id: string
  name: string
  workspaceId: string
  type: string
  mimeType: string
  metadata: Record<string, unknown>
  parentId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  size: number
  version: number
}

const files = new Map<string, MockFile>()

export function getAllFiles(workspaceId?: string): MockFile[] {
  const all = Array.from(files.values()).filter((f) => !f.deletedAt)
  return workspaceId ? all.filter((f) => f.workspaceId === workspaceId) : all
}

export function getFile(id: string): MockFile | undefined {
  const f = files.get(id)
  return f && !f.deletedAt ? f : undefined
}

export function createFile(data: Partial<MockFile> & { id: string }): MockFile {
  const now = new Date().toISOString()
  const file: MockFile = {
    id: data.id,
    name: data.name ?? 'Untitled Document',
    workspaceId: data.workspaceId ?? DEV_WORKSPACE.id,
    type: data.type ?? 'file',
    mimeType: data.mimeType ?? 'text/html',
    metadata: (data.metadata as Record<string, unknown>) ?? {},
    parentId: data.parentId ?? null,
    createdBy: data.createdBy ?? DEV_USER.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    size: 0,
    version: 1,
  }
  files.set(file.id, file)
  return file
}

export function updateFile(id: string, updates: Partial<MockFile>): MockFile | undefined {
  const file = files.get(id)
  if (!file || file.deletedAt) return undefined
  const updated = { ...file, ...updates, id, updatedAt: new Date().toISOString() }
  files.set(id, updated)
  return updated
}

export function deleteFile(id: string): void {
  const file = files.get(id)
  if (file) {
    file.deletedAt = new Date().toISOString()
  }
}
