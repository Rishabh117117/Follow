'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-client'

export interface NotificationItem {
  id: string
  workspaceId: string
  userId: string
  type:
    | 'mention'
    | 'comment'
    | 'share'
    | 'invite'
    | 'agent_complete'
    | 'prompt_card'
    | 'system'
    | 'tension'
    | 'conflict'
  title: string
  body: string
  link: string | null
  metadata: Record<string, unknown>
  read: boolean
  createdAt: string
}

interface UnreadCountResponse {
  count: number
}

interface UseNotificationsResult {
  unreadCount: number
  notifications: NotificationItem[]
  isOpen: boolean
  isLoading: boolean
  toggleOpen: () => void
  open: () => void
  close: () => void
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  refresh: () => Promise<void>
}

export function useNotifications(workspaceId: string | undefined): UseNotificationsResult {
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const fetchUnread = useCallback(async () => {
    if (!workspaceId) return
    const res = await api.get<UnreadCountResponse>(
      `/api/notifications/unread-count?workspaceId=${workspaceId}`
    )
    if (res.data) setUnreadCount(res.data.count ?? 0)
  }, [workspaceId])

  const fetchList = useCallback(async () => {
    if (!workspaceId) return
    setIsLoading(true)
    try {
      const res = await api.get<NotificationItem[]>(
        `/api/notifications?workspaceId=${workspaceId}&limit=20`
      )
      if (res.data) setNotifications(res.data)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Poll unread count every 30s
  useEffect(() => {
    fetchUnread()
    const id = setInterval(fetchUnread, 30_000)
    return () => clearInterval(id)
  }, [fetchUnread])

  // Lazy-load list when opened
  useEffect(() => {
    if (isOpen) fetchList()
  }, [isOpen, fetchList])

  // Listen for WebSocket pushes (best-effort: window event channel)
  useEffect(() => {
    function onPush(e: Event) {
      const detail = (e as CustomEvent).detail as { type?: string; payload?: NotificationItem }
      if (detail?.type === 'notification' && detail.payload) {
        setUnreadCount((c) => c + 1)
        setNotifications((prev) => [detail.payload!, ...prev].slice(0, 50))
      }
    }
    window.addEventListener('ws:notification', onPush as EventListener)
    return () => window.removeEventListener('ws:notification', onPush as EventListener)
  }, [])

  const markRead = useCallback(async (id: string) => {
    await api.patch(`/api/notifications/${id}/read`, {})
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
  }, [])

  const markAllRead = useCallback(async () => {
    if (!workspaceId) return
    await api.post('/api/notifications/mark-all-read', { workspaceId })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
  }, [workspaceId])

  return {
    unreadCount,
    notifications,
    isOpen,
    isLoading,
    toggleOpen: () => setIsOpen((v) => !v),
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    markRead,
    markAllRead,
    refresh: fetchList,
  }
}
