/**
 * Sharing Store (Sprint FE-5)
 *
 * Single source of truth for the sharing layer in the FE:
 *   - SH-1 passcode lock state + session token
 *   - SH-1 active privacy preset
 *   - SH-2 pending context requests inbox
 *
 * Replaces ad-hoc fetching across components. The session token lives
 * here so the request inbox + slice controls can pull it without prop
 * drilling. All API calls use the project's `api` client.
 */

import { create } from 'zustand'
import { api } from '@/lib/api-client'

export interface PendingRequest {
  id: string
  requesterId: string
  responderId: string
  workspaceId: string
  scopeType: 'document' | 'topic' | 'temporal'
  scopeRefId?: string | null
  query: string
  status: string
  urgency?: string | null
  reason?: string | null
  expiresAt?: string | null
  createdAt?: string | null
}

interface SharingState {
  // Lock state (mirrored from /api/sharing/status)
  isLocked: boolean
  hasPasscode: boolean
  activePreset: string
  sessionExpiresAt: string | null

  // Session token (from passcode unlock — not persisted, lives in memory)
  sessionToken: string | null

  // Pending context requests inbox
  pendingRequests: PendingRequest[]

  // Mutators
  setSessionToken: (token: string | null) => void
  setLockState: (state: {
    isLocked: boolean
    hasPasscode: boolean
    activePreset: string
    sessionExpiresAt?: string | null
  }) => void
  setPendingRequests: (requests: PendingRequest[]) => void

  // Async actions (fetch + update local state)
  refreshLockState: () => Promise<void>
  refreshPendingRequests: () => Promise<void>
  lockIndex: () => Promise<void>
}

interface RawStatus {
  isLocked?: boolean
  hasPasscode?: boolean
  activePreset?: string
  sessionExpiresAt?: string | null
}

export const useSharingStore = create<SharingState>((set, get) => ({
  isLocked: true,
  hasPasscode: false,
  activePreset: 'balanced',
  sessionExpiresAt: null,
  sessionToken: null,
  pendingRequests: [],

  setSessionToken: (token) =>
    set({
      sessionToken: token,
      // When we receive a token, the index is by definition unlocked
      isLocked: token ? false : get().isLocked,
    }),

  setLockState: (state) =>
    set({
      isLocked: state.isLocked,
      hasPasscode: state.hasPasscode,
      activePreset: state.activePreset,
      sessionExpiresAt: state.sessionExpiresAt ?? null,
    }),

  setPendingRequests: (requests) => set({ pendingRequests: requests }),

  refreshLockState: async () => {
    try {
      const res = await api.get<RawStatus>('/api/sharing/status')
      const data = res.data ?? {}
      set({
        isLocked: data.isLocked ?? true,
        hasPasscode: !!data.hasPasscode,
        activePreset: data.activePreset ?? 'balanced',
        sessionExpiresAt: data.sessionExpiresAt ?? null,
      })
    } catch {
      // Endpoint may not be available in dev — keep current state
    }
  },

  refreshPendingRequests: async () => {
    try {
      const res = await api.get<PendingRequest[]>('/api/sharing/requests/inbox')
      if (Array.isArray(res.data)) {
        set({ pendingRequests: res.data })
      }
    } catch {
      // Non-fatal
    }
  },

  lockIndex: async () => {
    try {
      await api.post<{ locked: boolean }>('/api/sharing/passcode/lock')
      set({ isLocked: true, sessionToken: null, sessionExpiresAt: null })
    } catch {
      // Refresh anyway in case the server lock succeeded but the response failed
      void get().refreshLockState()
    }
  },
}))
