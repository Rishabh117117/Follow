import { create } from 'zustand'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

interface ExtensionState {
  // Auth
  isAuthenticated: boolean
  userId: string | null
  workspaceId: string | null
  apiBaseUrl: string
  authExpired: boolean

  // Connection
  isConnected: boolean
  connectionStatus: ConnectionStatus

  // Actions
  setAuth: (auth: { userId: string; workspaceId: string; apiBaseUrl: string }) => void
  clearAuth: () => void
  setConnected: (connected: boolean) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setAuthExpired: (expired: boolean) => void
  setApiBaseUrl: (url: string) => void
}

export const useExtensionStore = create<ExtensionState>((set) => ({
  isAuthenticated: false,
  userId: null,
  workspaceId: null,
  apiBaseUrl: 'http://localhost:3001',
  authExpired: false,
  isConnected: false,
  connectionStatus: 'connected',

  setAuth: ({ userId, workspaceId, apiBaseUrl }) =>
    set({
      isAuthenticated: true,
      userId,
      workspaceId,
      apiBaseUrl,
      authExpired: false,
    }),

  clearAuth: () =>
    set({
      isAuthenticated: false,
      userId: null,
      workspaceId: null,
    }),

  setConnected: (connected) =>
    set({
      isConnected: connected,
      connectionStatus: connected ? 'connected' : 'disconnected',
    }),

  setConnectionStatus: (status) =>
    set({ connectionStatus: status, isConnected: status === 'connected' }),

  setAuthExpired: (expired) => set({ authExpired: expired }),

  setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
}))
