import type { Workspace, WorkspaceMember, User } from './db'

export interface WorkspaceWithMembers extends Workspace {
  members: (WorkspaceMember & { user: User })[]
}

export interface WorkspaceNavItem {
  id: string
  name: string
  slug: string
  avatarUrl?: string
}

export interface ApiResponse<T = unknown> {
  data: T | null
  error: ApiError | null
  meta?: ApiMeta
}

export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export interface ApiMeta {
  page?: number
  pageSize?: number
  total?: number
  hasMore?: boolean
}

// ─── Projects ────────────────────────────────────────────────────────────

export interface Project {
  id: string
  workspaceId: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  strandId: string | null
  isProject: boolean
  canvasFileId: string | null
  documents: ProjectDocument[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ProjectDocument {
  id: string
  spaceId: string
  fileId: string | null
  externalDocumentId: string | null
  title: string
  docType: 'internal' | 'google_docs' | 'google_sheets' | 'google_slides'
  strandId?: string | null
  addedAt: string
}
