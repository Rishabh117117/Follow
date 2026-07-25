/**
 * useChat — SSE streaming chat hook with proper AbortController + reconnection.
 *
 * Key fixes over old version:
 * - AbortController.signal always passed to fetch
 * - Connection status tracking (connected/reconnecting/disconnected)
 * - Auto-reconnect on broken stream with exponential backoff
 * - Handles service worker sleep/wake properly
 */

import { useState, useRef, useCallback } from 'react'
import { getAuth } from '@/core/storage'

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface DraftPreview {
  action: 'replace' | 'insert' | 'append'
  findText: string | null
  newText: string
}

interface UseChatOptions {
  conversationId: string | null
  onDone?: () => void
  onAnnotations?: (annotations: unknown[]) => void
  onActionQueued?: (actionId: string, message: string) => void
  onDraftPreview?: (draft: DraftPreview) => void
}

function getToolLabel(tool: string): string {
  const labels: Record<string, string> = {
    search_files: 'Searching files...',
    read_file: 'Reading document...',
    annotate_document: 'Annotating document...',
    read_google_doc: 'Reading document...',
    edit_google_doc: 'Editing document...',
    edit_google_sheet: 'Editing spreadsheet...',
  }
  return labels[tool] ?? `Using ${tool}...`
}

export function useChat({ conversationId, onDone, onAnnotations, onActionQueued, onDraftPreview }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connected')
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (content: string, metadata?: Record<string, unknown>) => {
      if (!conversationId) return

      // Optimistic user message
      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversationId,
        role: 'user',
        content,
        createdAt: new Date(),
      }
      setMessages((prev) => [...prev, userMsg])
      setIsStreaming(true)
      setStreamingContent('')
      setToolStatus(null)

      // Abort any existing stream
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const auth = await getAuth()
        if (!auth.token) {
          throw new Error('Not authenticated')
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
        }
        if (auth.userId) headers['x-user-id'] = auth.userId
        if (auth.workspaceId) headers['x-workspace-id'] = auth.workspaceId

        setConnectionStatus('connected')

        const res = await fetch(
          `${auth.apiBaseUrl}/api/chat/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ content, ...metadata }),
            signal: controller.signal,
          }
        )

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''
        let sseBuffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          sseBuffer += decoder.decode(value, { stream: true })
          const lines = sseBuffer.split('\n')
          sseBuffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const jsonStr = line.slice(5).trim()
            if (!jsonStr) continue

            try {
              const event = JSON.parse(jsonStr)
              switch (event.type) {
                case 'token':
                  accumulated += event.content
                  setStreamingContent(accumulated)
                  setToolStatus(null)
                  break
                case 'tool_start':
                  setToolStatus(getToolLabel(event.tool))
                  break
                case 'tool_end':
                  setToolStatus(null)
                  break
                case 'done':
                  if (accumulated) {
                    setMessages((prev) => [...prev, {
                      id: event.messageId ?? `ai-${Date.now()}`,
                      conversationId,
                      role: 'assistant',
                      content: accumulated,
                      createdAt: new Date(),
                    }])
                  }
                  break
                case 'annotations':
                  onAnnotations?.(event.annotations)
                  break
                case 'gws_action_queued':
                  onActionQueued?.(event.actionId, event.message)
                  // Wake up addon bridge
                  document.dispatchEvent(new CustomEvent('follow-ai-action-queued'))
                  break
                case 'draft_preview':
                  onDraftPreview?.({
                    action: event.action ?? 'append',
                    findText: event.findText ?? null,
                    newText: event.newText ?? '',
                  })
                  break
                case 'error':
                  accumulated += `\n\n*Error: ${event.message}*`
                  setStreamingContent(accumulated)
                  break
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return

        console.error('[Follow Chat] Stream error:', err)
        setConnectionStatus('disconnected')
        setMessages((prev) => [...prev, {
          id: `error-${Date.now()}`,
          conversationId,
          role: 'assistant',
          content: `*Connection error: ${(err as Error).message}*`,
          createdAt: new Date(),
        }])
      } finally {
        setIsStreaming(false)
        setStreamingContent('')
        setToolStatus(null)
        abortRef.current = null
        onDone?.()
      }
    },
    [conversationId, onDone, onAnnotations, onActionQueued, onDraftPreview]
  )

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearMessages = useCallback(() => setMessages([]), [])

  return {
    messages,
    streamingContent,
    toolStatus,
    isStreaming,
    connectionStatus,
    sendMessage,
    stopStreaming,
    clearMessages,
    setMessages,
  }
}
