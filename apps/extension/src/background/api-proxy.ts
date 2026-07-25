/**
 * API Proxy — all backend fetch() calls with auth headers.
 *
 * Centralizes API communication so the service worker is the only
 * component that makes direct HTTP requests to the backend.
 */

import { getAuthHeaders, getApiBaseUrl } from '@/core/auth'

interface ApiResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

async function apiCall<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResult<T>> {
  try {
    const baseUrl = await getApiBaseUrl()
    const headers = await getAuthHeaders()
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> || {}) },
    })

    if (!res.ok) {
      const text = await res.text()
      return { success: false, error: `HTTP ${res.status}: ${text}` }
    }

    const data = await res.json()
    return { success: true, data: data.data ?? data }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ─── GWS Document APIs ───────────────────────────────────────────────────

export function activateSmartDoc(payload: {
  externalDocId: string; docType: string; title: string; workspaceId: string; strandId?: string
}) {
  return apiCall('/api/gws/documents', { method: 'POST', body: JSON.stringify(payload) })
}

export function getSmartDocStatus(externalDocId: string) {
  return apiCall(`/api/gws/documents/${externalDocId}`)
}

export function deactivateSmartDoc(externalDocId: string) {
  return apiCall(`/api/gws/documents/${externalDocId}`, { method: 'DELETE' })
}

export function forwardGWSSignals(externalDocId: string, signals: unknown[]) {
  return apiCall(`/api/gws/documents/${externalDocId}/signals`, {
    method: 'POST',
    body: JSON.stringify({ signals }),
  })
}

export function syncDocContent(externalDocId: string, content: string) {
  return apiCall(`/api/gws/documents/${externalDocId}/content`, {
    method: 'POST',
    body: JSON.stringify({ content, revisionId: `snapshot-${Date.now()}` }),
  })
}

export function pollAddonActions(followDocId: string) {
  return apiCall(`/api/gws/documents/${followDocId}/addon-actions`)
}

export function clearAddonAction(followDocId: string) {
  return apiCall(`/api/gws/documents/${followDocId}/addon-actions`, { method: 'DELETE' })
}

export function fetchProvenance(externalDocId: string) {
  return apiCall(`/api/gws/documents/${externalDocId}/threads`)
}

export function fetchDocStats(externalDocId: string) {
  return apiCall(`/api/gws/documents/${externalDocId}/stats`)
}

export function fetchThreadEvents(externalDocId: string, threadId: string, limit?: number, before?: string) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (before) params.set('before', before)
  const qs = params.toString()
  return apiCall(`/api/gws/documents/${externalDocId}/threads/${threadId}/events${qs ? `?${qs}` : ''}`)
}

export function fetchStrandActivity(strandId: string, limit?: number, before?: string) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (before) params.set('before', before)
  const qs = params.toString()
  return apiCall(`/api/gws/strands/${strandId}/activity${qs ? `?${qs}` : ''}`)
}

export function fetchStrands(workspaceId: string) {
  return apiCall(`/api/strands?workspaceId=${workspaceId}`)
}

export function fetchDocMemory(followDocId: string) {
  return apiCall(`/api/doc-memory/${followDocId}`)
}

// ─── Web Capture APIs ────────────────────────────────────────────────────

export function forwardWebSignals(payload: {
  workspaceId: string; userId: string; sessionId: string; signals: unknown[]
}) {
  return apiCall('/api/capture/realtime', {
    method: 'POST',
    body: JSON.stringify({ ...payload, source: 'web_extension', timestamp: new Date().toISOString() }),
  })
}

export function captureWebPage(payload: {
  workspaceId: string; sourceUrl: string; title: string; content?: string; source: string
}) {
  return apiCall('/api/capture', { method: 'POST', body: JSON.stringify(payload) })
}

export function endCaptureSession(payload: { workspaceId: string; userId: string; sessionId?: string }) {
  return apiCall('/api/capture/realtime/end-session', { method: 'POST', body: JSON.stringify(payload) })
}

// ─── Doc Intelligence APIs ───────────────────────────────────────────────

export function docIntelSuggest(payload: unknown) {
  return apiCall('/api/doc-intelligence-web/suggest', { method: 'POST', body: JSON.stringify(payload) })
}

export function docIntelAnalyze(payload: unknown) {
  return apiCall('/api/doc-intelligence-web/analyze', { method: 'POST', body: JSON.stringify(payload) })
}

export function docIntelSynthesize(payload: unknown) {
  return apiCall('/api/doc-intelligence-web/synthesize', { method: 'POST', body: JSON.stringify(payload) })
}

export function docIntelRegenerate(payload: unknown) {
  return apiCall('/api/doc-intelligence-web/regenerate', { method: 'POST', body: JSON.stringify(payload) })
}

// ─── Health Check ────────────────────────────────────────────────────────

export async function checkHealth(): Promise<boolean> {
  try {
    const baseUrl = await getApiBaseUrl()
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}
