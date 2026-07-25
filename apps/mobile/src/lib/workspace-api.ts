import { apiRequest } from './api'

export type FileRow = {
  id: string
  workspaceId: string
  spaceId: string | null
  parentFolderId: string | null
  name: string
  type: 'file' | 'folder'
  mimeType: string | null
  metadata: Record<string, unknown> | null
  createdByName: string | null
  updatedAt: string
  createdAt: string
}

export type SpaceRow = {
  id: string
  workspaceId: string
  name: string
  slug: string
  description: string | null
  color: string | null
  icon: string | null
  createdAt: string
  updatedAt: string
}

export type AiStateResponse = {
  statePersistent?: {
    workPatterns?: {
      peakHours?: string
      workStyle?: string
      aiAcceptanceRate?: number
      avgSessionMinutes?: number
      collabStyle?: string
    }
    longTermKnowledge?: Array<{
      fact: string
      confidence: 'high' | 'medium' | 'low'
      updatedAt?: string
    }>
  }
}

export type MeResponse = {
  user: {
    id: string
    email: string
    name: string
    avatarUrl: string | null
    image: string | null
  }
  profile: {
    settings: Record<string, unknown>
    promptPreferences: Record<string, unknown>
    knownFacts: unknown[]
  }
  statePersistent: Record<string, unknown>
}

export function listFiles(params: {
  workspaceId: string
  mimeType?: string
}): Promise<FileRow[]> {
  const qs = new URLSearchParams({ workspaceId: params.workspaceId })
  if (params.mimeType) qs.set('mimeType', params.mimeType)
  return apiRequest<FileRow[]>(`/api/files?${qs.toString()}`)
}

export function getFile(id: string): Promise<FileRow & { content?: unknown }> {
  return apiRequest(`/api/files/${id}`)
}

export function listSpaces(workspaceId: string): Promise<SpaceRow[]> {
  return apiRequest<SpaceRow[]>(`/api/spaces?workspaceId=${workspaceId}`)
}

export function getMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>('/api/users/me')
}

export function getAiState(workspaceId: string): Promise<AiStateResponse> {
  return apiRequest<AiStateResponse>(`/api/ai-state?workspaceId=${workspaceId}`)
}

export function getUnreadCount(): Promise<{ count: number }> {
  return apiRequest<{ count: number }>('/api/notifications/unread-count')
}
