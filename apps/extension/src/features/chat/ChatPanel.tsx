/**
 * ChatPanel — floating, draggable, resizable chat panel in Shadow DOM.
 *
 * Position/size persisted to chrome.storage. Connection status indicator.
 * Minimizes to a small dot at bottom-right.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ChatMessages } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { useChat } from './use-chat'
import { sendToBackground } from '@/core/message-bus'
import { getAuth } from '@/core/storage'

const PANEL_STORAGE_KEY = 'follow_chat_panel_state'
const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 480
const DOT_SIZE = 40

interface PanelPosition { x: number; y: number; width: number; height: number; minimized: boolean }

export function ChatPanel() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(true)
  const [position, setPosition] = useState<PanelPosition>({
    x: window.innerWidth - DEFAULT_WIDTH - 20,
    y: window.innerHeight - DEFAULT_HEIGHT - 20,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minimized: true,
  })
  const panelRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const {
    messages, streamingContent, toolStatus, isStreaming,
    connectionStatus, sendMessage, stopStreaming,
  } = useChat({
    conversationId,
    onActionQueued: (_id, _msg) => {
      document.dispatchEvent(new CustomEvent('follow-ai-action-queued'))
    },
  })

  // Load persisted position
  useEffect(() => {
    chrome.storage.local.get(PANEL_STORAGE_KEY).then((data) => {
      const saved = data[PANEL_STORAGE_KEY] as PanelPosition | undefined
      if (saved) {
        setPosition(saved)
        setMinimized(saved.minimized)
      }
    })
  }, [])

  // Create conversation on first expand
  const handleExpand = useCallback(async () => {
    setMinimized(false)
    const newPos = { ...position, minimized: false }
    setPosition(newPos)
    chrome.storage.local.set({ [PANEL_STORAGE_KEY]: newPos })

    if (!conversationId) {
      const auth = await getAuth()
      if (auth.workspaceId) {
        const result = await sendToBackground<{ id: string }>({
          type: 'CAPTURE_PAGE',
          payload: { sourceUrl: '', title: '', content: '' },
        })
        // Create conversation via API
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`
          if (auth.userId) headers['x-user-id'] = auth.userId
          if (auth.workspaceId) headers['x-workspace-id'] = auth.workspaceId

          const res = await fetch(`${auth.apiBaseUrl}/api/chat/conversations`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ workspaceId: auth.workspaceId, type: 'standard' }),
          })
          if (res.ok) {
            const data = await res.json()
            setConversationId(data.data?.id || null)
          }
        } catch (err) {
          console.warn('[Follow Chat] Failed to create conversation:', err)
        }
      }
    }
  }, [conversationId, position])

  const handleMinimize = useCallback(() => {
    setMinimized(true)
    const newPos = { ...position, minimized: true }
    setPosition(newPos)
    chrome.storage.local.set({ [PANEL_STORAGE_KEY]: newPos })
  }, [position])

  // Drag handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const newX = Math.max(0, Math.min(window.innerWidth - position.width, e.clientX - dragOffset.current.x))
      const newY = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffset.current.y))
      setPosition((prev) => ({ ...prev, x: newX, y: newY }))
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      setPosition((prev) => {
        chrome.storage.local.set({ [PANEL_STORAGE_KEY]: prev })
        return prev
      })
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [position])

  const handleSend = useCallback((content: string) => {
    sendMessage(content, {
      documentContent: undefined,
      navContext: { url: window.location.href, title: document.title },
    })
  }, [sendMessage])

  // Minimized dot
  if (minimized) {
    return (
      <div
        onClick={handleExpand}
        style={{
          position: 'fixed', bottom: '20px', right: '20px',
          width: `${DOT_SIZE}px`, height: `${DOT_SIZE}px`, borderRadius: '50%',
          background: '#6366F1', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', pointerEvents: 'auto',
          zIndex: 2147483647, transition: 'transform 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
        onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
      >
        <span style={{ color: '#FFFFFF', fontSize: '18px', fontWeight: 700 }}>F</span>
        {/* Connection status dot */}
        <span style={{
          position: 'absolute', top: '2px', right: '2px',
          width: '8px', height: '8px', borderRadius: '50%',
          background: connectionStatus === 'connected' ? '#16A34A'
            : connectionStatus === 'reconnecting' ? '#F59E0B' : '#DC2626',
          border: '1.5px solid #FFFFFF',
        }} />
      </div>
    )
  }

  // Expanded panel
  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: `${position.x}px`, top: `${position.y}px`,
        width: `${position.width}px`, height: `${position.height}px`,
        background: '#FFFFFF', borderRadius: '12px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', pointerEvents: 'auto',
        zIndex: 2147483647, border: '1px solid #E8EAED',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          display: 'flex', alignItems: 'center', padding: '8px 12px',
          borderBottom: '1px solid #E8EAED', cursor: 'grab',
          background: '#FAFAFA', userSelect: 'none', flexShrink: 0,
        }}
      >
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%', marginRight: '8px',
          background: connectionStatus === 'connected' ? '#16A34A'
            : connectionStatus === 'reconnecting' ? '#F59E0B' : '#DC2626',
        }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#202124', flex: 1 }}>
          Follow
        </span>
        <button
          onClick={handleMinimize}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '16px', color: '#9AA0A6', padding: '0 4px', lineHeight: 1,
          }}
        >
          &minus;
        </button>
      </div>

      {/* Messages */}
      <ChatMessages
        messages={messages}
        streamingContent={streamingContent}
        toolStatus={toolStatus}
        isStreaming={isStreaming}
        connectionStatus={connectionStatus}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onCancel={stopStreaming}
        isStreaming={isStreaming}
        disabled={!conversationId}
      />
    </div>
  )
}
