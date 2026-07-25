/**
 * ChatMessages — message list with streaming indicator.
 */

import React, { useEffect, useRef } from 'react'
import type { ChatMessage, ConnectionStatus } from './use-chat'

interface Props {
  messages: ChatMessage[]
  streamingContent: string
  toolStatus: string | null
  isStreaming: boolean
  connectionStatus: ConnectionStatus
}

export function ChatMessages({ messages, streamingContent, toolStatus, isStreaming, connectionStatus }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Connection status */}
      {connectionStatus !== 'connected' && (
        <div style={{
          padding: '6px 10px', borderRadius: '6px', fontSize: '11px', textAlign: 'center',
          background: connectionStatus === 'reconnecting' ? '#FEF3C7' : '#FEE2E2',
          color: connectionStatus === 'reconnecting' ? '#92400E' : '#991B1B',
        }}>
          {connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
        </div>
      )}

      {messages.length === 0 && !isStreaming && (
        <div style={{ textAlign: 'center', color: '#9AA0A6', fontSize: '13px', paddingTop: '40px' }}>
          Ask Follow anything about your document
        </div>
      )}

      {messages.map((msg) => (
        <div key={msg.id} style={{
          alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: '12px',
          fontSize: '13px',
          lineHeight: '1.4',
          background: msg.role === 'user' ? '#6366F1' : '#F1F3F4',
          color: msg.role === 'user' ? '#FFFFFF' : '#202124',
          wordBreak: 'break-word',
        }}>
          {msg.content}
        </div>
      ))}

      {/* Streaming content */}
      {isStreaming && streamingContent && (
        <div style={{
          alignSelf: 'flex-start', maxWidth: '85%', padding: '8px 12px',
          borderRadius: '12px', fontSize: '13px', lineHeight: '1.4',
          background: '#F1F3F4', color: '#202124',
        }}>
          {streamingContent}
        </div>
      )}

      {/* Tool status */}
      {toolStatus && (
        <div style={{
          alignSelf: 'flex-start', padding: '4px 10px', borderRadius: '10px',
          fontSize: '11px', background: '#EEF2FF', color: '#6366F1',
        }}>
          {toolStatus}
        </div>
      )}

      {/* Typing indicator */}
      {isStreaming && !streamingContent && !toolStatus && (
        <div style={{
          alignSelf: 'flex-start', padding: '8px 12px', borderRadius: '12px',
          background: '#F1F3F4', color: '#9AA0A6', fontSize: '13px',
        }}>
          Thinking...
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
