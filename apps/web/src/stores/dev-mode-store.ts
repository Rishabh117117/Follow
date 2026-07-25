import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DevModeState {
  devMode: boolean
  toggleDevMode: () => void
  setDevMode: (enabled: boolean) => void
}

export const useDevModeStore = create<DevModeState>()(
  persist(
    (set) => ({
      devMode: false,

      toggleDevMode: () => set((s) => ({ devMode: !s.devMode })),

      setDevMode: (enabled) => set({ devMode: enabled }),
    }),
    {
      name: 'follow-dev-mode',
    }
  )
)
