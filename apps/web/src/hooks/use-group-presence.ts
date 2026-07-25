'use client'

/**
 * useGroupPresence — manages a single WebSocket connection to the group room
 * `group:{conversationId}` and exposes presence + typing state. The server
 * (packages/api/src/ws/index.ts) tracks members per room and rebroadcasts
 * group_typing / group_member_online / group_member_offline / group_message_sent
 * events to the rest of the room.
 *
 * Designed to be cheap: a single shared socket per (workspaceId, userId), and
 * a small pubsub for the typing indicator that auto-clears 4s after the last
 * keystroke from each remote user.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

const WS_URL =
  process.env['NEXT_PUBLIC_WS_URL'] ??
  (typeof window !== 'undefined'
    ? `ws://${window.location.hostname}:3002`
    : 'ws://localhost:3002')

const TYPING_CLEAR_MS = 4000

interface GroupPresenceState {
  online: Set<string>
  typing: Map<string, { userName: string; clearAt: number }>
  ready: boolean
}

interface UseGroupPresenceOptions {
  conversationId: string | null
  workspaceId: string
  userId: string
  userName: string
  onMessageSent?: () => void
}

export function useGroupPresence({
  conversationId,
  workspaceId,
  userId,
  userName,
  onMessageSent,
}: UseGroupPresenceOptions) {
  const [state, setState] = useState<GroupPresenceState>({
    online: new Set(),
    typing: new Map(),
    ready: false,
  })
  const socketRef = useRef<WebSocket | null>(null)
  const lastTypingSentRef = useRef<number>(0)
  const onMessageSentRef = useRef(onMessageSent)
  useEffect(() => {
    onMessageSentRef.current = onMessageSent
  }, [onMessageSent])

  // Open / close the socket and join the group room.
  useEffect(() => {
    if (!conversationId || !workspaceId) return
    const effectiveUserId = userId || DEV_USER.id
    const effectiveWorkspaceId = workspaceId || DEV_WORKSPACE.id

    let cancelled = false
    const url = `${WS_URL}/?userId=${encodeURIComponent(effectiveUserId)}&workspaceId=${encodeURIComponent(effectiveWorkspaceId)}`
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (err) {
      console.warn('[useGroupPresence] WebSocket open failed:', err)
      return
    }
    socketRef.current = socket

    socket.addEventListener('open', () => {
      if (cancelled) return
      socket.send(
        JSON.stringify({ type: 'group_join', payload: { conversationId } })
      )
      setState((s) => ({ ...s, ready: true }))
    })

    socket.addEventListener('message', (ev) => {
      let msg: { type: string; payload?: Record<string, unknown> }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      switch (msg.type) {
        case 'group_online_list': {
          const list = (msg.payload?.['online'] as string[] | undefined) ?? []
          setState((s) => ({ ...s, online: new Set(list) }))
          break
        }
        case 'group_member_online': {
          const uid = msg.payload?.['userId'] as string | undefined
          if (!uid) break
          setState((s) => {
            const online = new Set(s.online)
            online.add(uid)
            return { ...s, online }
          })
          break
        }
        case 'group_member_offline': {
          const uid = msg.payload?.['userId'] as string | undefined
          if (!uid) break
          setState((s) => {
            const online = new Set(s.online)
            online.delete(uid)
            return { ...s, online }
          })
          break
        }
        case 'group_typing': {
          const uid = msg.payload?.['userId'] as string | undefined
          const uname = (msg.payload?.['userName'] as string | undefined) ?? 'Someone'
          if (!uid || uid === effectiveUserId) break
          setState((s) => {
            const typing = new Map(s.typing)
            typing.set(uid, { userName: uname, clearAt: Date.now() + TYPING_CLEAR_MS })
            return { ...s, typing }
          })
          break
        }
        case 'group_message_sent': {
          onMessageSentRef.current?.()
          break
        }
      }
    })

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) socketRef.current = null
    })

    return () => {
      cancelled = true
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({ type: 'group_leave', payload: { conversationId } })
          )
        }
        socket.close()
      } catch {
        /* noop */
      }
      socketRef.current = null
    }
  }, [conversationId, workspaceId, userId])

  // Sweep stale typing entries every second.
  useEffect(() => {
    const id = setInterval(() => {
      setState((s) => {
        const now = Date.now()
        let changed = false
        const next = new Map(s.typing)
        for (const [uid, entry] of next) {
          if (entry.clearAt <= now) {
            next.delete(uid)
            changed = true
          }
        }
        return changed ? { ...s, typing: next } : s
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  /** Throttled typing emit — calls every 3 s while the user is typing. */
  const emitTyping = useCallback(() => {
    if (!conversationId) return
    const now = Date.now()
    if (now - lastTypingSentRef.current < 3000) return
    lastTypingSentRef.current = now
    const sock = socketRef.current
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(
        JSON.stringify({
          type: 'group_typing',
          payload: { conversationId, userName },
        })
      )
    }
  }, [conversationId, userName])

  /** Notify other clients that we just persisted a new message. */
  const emitMessageSent = useCallback(() => {
    if (!conversationId) return
    const sock = socketRef.current
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(
        JSON.stringify({
          type: 'group_message_sent',
          payload: { conversationId },
        })
      )
    }
  }, [conversationId])

  return {
    online: state.online,
    typingUsers: Array.from(state.typing.values()).map((t) => t.userName),
    ready: state.ready,
    emitTyping,
    emitMessageSent,
  }
}
