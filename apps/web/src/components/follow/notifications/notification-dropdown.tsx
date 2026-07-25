'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { NotificationItem } from '@/hooks/use-notifications'

const TYPE_ICONS: Record<NotificationItem['type'], string> = {
  mention: '@',
  comment: '💬',
  share: '👥',
  invite: '✉️',
  agent_complete: '🤖',
  prompt_card: '🃏',
  system: '📢',
  tension: '⚡',
  conflict: '⚠️',
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

interface NotificationDropdownProps {
  items: NotificationItem[]
  unreadCount: number
  onClose: () => void
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
}

export function NotificationDropdown({
  items,
  unreadCount,
  onClose,
  onMarkRead,
  onMarkAllRead,
}: NotificationDropdownProps) {
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed bottom-20 right-4 z-[60] max-h-[400px] w-[320px] overflow-auto rounded-xl border bg-white shadow-xl"
      style={{ borderColor: 'var(--n150, #e5e5e5)' }}
    >
      <div
        className="sticky top-0 flex items-center justify-between border-b bg-white px-4 py-2.5"
        style={{ borderColor: 'var(--n150, #e5e5e5)' }}
      >
        <div className="text-[13px] font-semibold" style={{ color: 'var(--n800, #262626)' }}>
          Notifications{' '}
          {unreadCount > 0 && (
            <span className="text-[11px] font-normal" style={{ color: 'var(--n400, #a3a3a3)' }}>
              ({unreadCount} unread)
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            className="text-[11px] font-medium"
            style={{ color: 'var(--ai, #6366F1)' }}
          >
            Mark all read
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div
          className="px-4 py-8 text-center text-[12px]"
          style={{ color: 'var(--n400, #a3a3a3)' }}
        >
          You're all caught up
        </div>
      ) : (
        items.map((n) => (
          <button
            key={n.id}
            onClick={() => {
              if (!n.read) onMarkRead(n.id)
              if (n.link) router.push(n.link)
              onClose()
            }}
            className="flex w-full items-start gap-2.5 border-b px-4 py-3 text-left hover:bg-gray-50"
            style={{
              borderColor: 'var(--n100, #f5f5f5)',
              borderLeft: n.read ? undefined : '2px solid var(--ai, #6366F1)',
            }}
          >
            <div
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px]"
              style={{ background: 'var(--n100, #f5f5f5)' }}
            >
              {TYPE_ICONS[n.type] ?? '•'}
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[12px]"
                style={{
                  color: 'var(--n800, #262626)',
                  fontWeight: n.read ? 400 : 600,
                }}
              >
                {n.title}
              </div>
              {n.body && (
                <div className="line-clamp-2 text-[11px]" style={{ color: 'var(--n500, #737373)' }}>
                  {n.body}
                </div>
              )}
              <div className="text-[10px]" style={{ color: 'var(--n400, #a3a3a3)' }}>
                {timeAgo(n.createdAt)} ago
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  )
}
