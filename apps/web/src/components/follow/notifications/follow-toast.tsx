'use client'

/**
 * FollowToast — lightweight toast notification system for Follow mode.
 *
 * Uses a Zustand store for toast state and renders a fixed container
 * at the bottom-right of the viewport. Toasts auto-dismiss after 3 seconds.
 */

import { create } from 'zustand'
import { useEffect, useCallback } from 'react'
import { DURATION } from '@/lib/follow-animations'

// ─── Types ─────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'info' | 'warning' | 'error'

export interface Toast {
  id: string
  message: string
  type: ToastType
  /** Duration in ms before auto-dismiss (0 = manual only) */
  duration: number
  /** Whether the toast is in dismiss animation */
  isDismissing: boolean
}

// ─── Store ─────────────────────────────────────────────────────────────────

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType, duration?: number) => string
  dismissToast: (id: string) => void
  removeToast: (id: string) => void
  clearAll: () => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, type = 'info', duration = DURATION.toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    set((s) => ({
      toasts: [...s.toasts, { id, message, type, duration, isDismissing: false }],
    }))
    return id
  },

  dismissToast: (id) =>
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, isDismissing: true } : t)),
    })),

  removeToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),

  clearAll: () => set({ toasts: [] }),
}))

// ─── Convenience helpers ──────────────────────────────────────────────────

export function showToast(message: string, type: ToastType = 'info', duration?: number): string {
  return useToastStore.getState().addToast(message, type, duration)
}

// ─── Toast styling config ─────────────────────────────────────────────────

const TOAST_STYLES: Record<
  ToastType,
  { bg: string; border: string; icon: string; iconColor: string }
> = {
  success: { bg: '#F0FDF4', border: '#BBF7D0', icon: '✓', iconColor: '#166534' },
  info: { bg: 'var(--n50)', border: 'var(--n200)', icon: 'ℹ', iconColor: 'var(--ai)' },
  warning: { bg: '#FFFBEB', border: '#FEF3C7', icon: '⚠', iconColor: '#D97706' },
  error: { bg: '#FEF2F2', border: '#FECACA', icon: '✕', iconColor: '#DC2626' },
}

// ─── Components ───────────────────────────────────────────────────────────

function ToastItem({ toast }: { toast: Toast }) {
  const { dismissToast, removeToast } = useToastStore()
  const style = TOAST_STYLES[toast.type]

  // Auto-dismiss timer
  useEffect(() => {
    if (toast.duration <= 0) return
    const timer = setTimeout(() => {
      dismissToast(toast.id)
    }, toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, dismissToast])

  // Remove after dismiss animation
  useEffect(() => {
    if (!toast.isDismissing) return
    const timer = setTimeout(() => {
      removeToast(toast.id)
    }, DURATION.toastDismiss)
    return () => clearTimeout(timer)
  }, [toast.isDismissing, toast.id, removeToast])

  const handleDismiss = useCallback(() => {
    dismissToast(toast.id)
  }, [toast.id, dismissToast])

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 shadow-lg ${
        toast.isDismissing
          ? 'animate-[toastSlideOut_300ms_ease-in_forwards]'
          : 'animate-[toastSlideIn_200ms_ease-out]'
      }`}
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        maxWidth: 340,
      }}
      data-testid={`toast-${toast.id}`}
    >
      <span className="shrink-0 text-xs font-bold" style={{ color: style.iconColor }}>
        {style.icon}
      </span>
      <p className="flex-1 text-xs leading-relaxed" style={{ color: 'var(--n700)' }}>
        {toast.message}
      </p>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded p-0.5 text-[10px] transition-colors hover:bg-black/5"
        style={{ color: 'var(--n400)' }}
      >
        ✕
      </button>
    </div>
  )
}

export function FollowToastContainer() {
  const { toasts } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-16 right-4 z-[70] flex flex-col gap-2"
      data-testid="toast-container"
    >
      {toasts.slice(-5).map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
