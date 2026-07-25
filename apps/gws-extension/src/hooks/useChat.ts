/**
 * SSE Chat hook — port of useSSEChat adapted for Chrome Extension context.
 * Uses fetch() with ReadableStream for SSE parsing (EventSource not reliable from content scripts).
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { STORAGE_KEYS, DEFAULT_API_BASE_URL } from '@/lib/constants'

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
}

export interface AnnotationPayload {
  id: string
  spanText: string
  insight: string
  /** @deprecated use insight instead */
  explanation?: string
  category: string
  rating?: number | null
  /** Optional text formatting to apply directly in Google Docs */
  format?: 'underline' | 'bold' | 'italic'
}

export interface DraftPreviewPayload {
  action: 'replace' | 'insert' | 'append'
  findText: string | null
  newText: string
  summary?: string
}

interface UseChatOptions {
  conversationId: string | null
  onDone?: () => void
  onAnnotations?: (annotations: AnnotationPayload[]) => void
  onActionQueued?: (actionId: string, message: string) => void
  onDraftPreview?: (draft: DraftPreviewPayload) => void
}

interface ChatState {
  isStreaming: boolean
  streamingContent: string
  toolStatus: string | null
}

function getToolLabel(tool: string): string {
  const labels: Record<string, string> = {
    search_files: 'Searching files...',
    read_file: 'Reading document...',
    create_file: 'Creating file...',
    list_files: 'Listing files...',
    get_timeline_summary: 'Analyzing activity...',
    read_canvas: 'Reading canvas...',
    annotate_document: 'Annotating document...',
    // Google Workspace tools
    read_google_doc: 'Reading document...',
    edit_google_doc: 'Editing document...',
    annotate_google_doc: 'Annotating document...',
    edit_google_sheet: 'Editing spreadsheet...',
  }
  return labels[tool] ?? `Using ${tool}...`
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.USER_ID,
    STORAGE_KEYS.WORKSPACE_ID,
    STORAGE_KEYS.API_BASE_URL,
  ])

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = data[STORAGE_KEYS.AUTH_TOKEN] as string | undefined
  if (token) headers['Authorization'] = `Bearer ${token}`

  const userId = data[STORAGE_KEYS.USER_ID] as string | undefined
  if (userId) headers['x-user-id'] = userId

  const workspaceId = data[STORAGE_KEYS.WORKSPACE_ID] as string | undefined
  if (workspaceId) headers['x-workspace-id'] = workspaceId

  return headers
}

async function getApiBaseUrl(): Promise<string> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.API_BASE_URL)
  return (data[STORAGE_KEYS.API_BASE_URL] as string) || DEFAULT_API_BASE_URL
}

/**
 * Detect whether the user's message is explicitly asking the AI to
 * write, draft, or compose content that should be offered as an
 * insertable draft card.
 */
const DRAFT_INTENT_RE =
  /(write|draft|compose|rewrite|redraft|rephrase|generate|create|author|produce|add a paragraph|add a section)/i

export function hasDraftIntent(userMessage: string): boolean {
  return DRAFT_INTENT_RE.test(userMessage)
}

/**
 * Detect whether the user's message is asking the AI to check, review,
 * or analyze the document for issues — triggering underline marks.
 */
const ANALYSIS_INTENT_RE =
  /\b(check|review|analyze|fix|improve|underline|highlight|suggest|proofread|edit)\b.*\b(grammar|spelling|clarity|tone|conciseness|style|writing|text|document|errors|mistakes|issues)\b/i

export type AnalysisMode = 'grammar' | 'clarity' | 'conciseness' | 'tone' | 'structure'

const ANALYSIS_MODE_MAP: Record<string, AnalysisMode> = {
  grammar: 'grammar',
  spelling: 'grammar',
  errors: 'grammar',
  mistakes: 'grammar',
  clarity: 'clarity',
  tone: 'tone',
  conciseness: 'conciseness',
  style: 'tone',
  structure: 'structure',
}

export function detectAnalysisIntent(userMessage: string): { hasIntent: boolean; mode: AnalysisMode } {
  if (!ANALYSIS_INTENT_RE.test(userMessage)) {
    return { hasIntent: false, mode: 'grammar' }
  }
  // Extract the most specific mode keyword
  const lower = userMessage.toLowerCase()
  for (const [keyword, mode] of Object.entries(ANALYSIS_MODE_MAP)) {
    if (lower.includes(keyword)) {
      return { hasIntent: true, mode }
    }
  }
  // Default: if intent detected but no specific mode, default to grammar
  return { hasIntent: true, mode: 'grammar' }
}

export function useChat({ conversationId, onDone, onAnnotations, onActionQueued, onDraftPreview }: UseChatOptions) {
  const [state, setState] = useState<ChatState>({
    isStreaming: false,
    streamingContent: '',
    toolStatus: null,
  })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // Keep refs to callbacks so sendMessage closure always uses latest versions
  const onAnnotationsRef = useRef(onAnnotations)
  useEffect(() => { onAnnotationsRef.current = onAnnotations }, [onAnnotations])
  const onActionQueuedRef = useRef(onActionQueued)
  useEffect(() => { onActionQueuedRef.current = onActionQueued }, [onActionQueued])
  const onDraftPreviewRef = useRef(onDraftPreview)
  useEffect(() => { onDraftPreviewRef.current = onDraftPreview }, [onDraftPreview])

  const sendMessage = useCallback(
    async (
      content: string,
      metadata?: {
        googleDocId?: string
        docType?: string
        docTitle?: string
        documentContent?: string
      }
    ) => {
      if (!conversationId) return

      // Add optimistic user message
      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversationId,
        role: 'user',
        content,
        createdAt: new Date(),
      }
      setMessages((prev) => [...prev, userMsg])

      // Start streaming
      setState({ isStreaming: true, streamingContent: '', toolStatus: null })
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const headers = await getAuthHeaders()
        const apiBaseUrl = await getApiBaseUrl()

        const res = await fetch(
          `${apiBaseUrl}/api/chat/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              content,
              ...(metadata || {}),
            }),
            signal: controller.signal,
          }
        )

        if (!res.ok || !res.body) {
          throw new Error(`Failed to send message: HTTP ${res.status}`)
        }

        // Parse SSE stream via ReadableStream
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''
        let sseBuffer = ''

        let readerDone = false
        while (!readerDone) {
          const { done, value } = await reader.read()
          if (done) {
            readerDone = true
            break
          }

          sseBuffer += decoder.decode(value, { stream: true })
          const lines = sseBuffer.split('\n')
          sseBuffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const jsonStr = line.slice(5).trim()
              if (!jsonStr) continue

              try {
                const event = JSON.parse(jsonStr)
                switch (event.type) {
                  case 'token':
                    accumulated += event.content
                    setState((prev) => ({
                      ...prev,
                      streamingContent: accumulated,
                      toolStatus: null,
                    }))
                    break
                  case 'tool_start':
                    setState((prev) => ({
                      ...prev,
                      toolStatus: getToolLabel(event.tool),
                    }))
                    break
                  case 'tool_end':
                    setState((prev) => ({ ...prev, toolStatus: null }))
                    break
                  case 'done':
                    if (accumulated) {
                      const assistantMsg: ChatMessage = {
                        id: event.messageId ?? `ai-${Date.now()}`,
                        conversationId,
                        role: 'assistant',
                        content: accumulated,
                        createdAt: new Date(),
                      }
                      setMessages((prev) => [...prev, assistantMsg])
                    }
                    break
                  case 'annotations':
                    if (event.annotations && onAnnotationsRef.current) {
                      onAnnotationsRef.current(event.annotations as AnnotationPayload[])
                    }
                    break
                  case 'gws_action_queued':
                    if (onActionQueuedRef.current) {
                      onActionQueuedRef.current(event.actionId as string, event.message as string)
                    }
                    break
                  case 'draft_preview':
                    console.log('[Follow Chat] Received draft_preview event:', event)
                    if (onDraftPreviewRef.current) {
                      onDraftPreviewRef.current({
                        action: (event.action as 'replace' | 'insert' | 'append') ?? 'append',
                        findText: (event.findText as string | null) ?? null,
                        newText: (event.newText as string) ?? '',
                        summary: (event.summary as string) ?? undefined,
                      })
                    } else {
                      console.warn('[Follow Chat] draft_preview received but no handler registered')
                    }
                    break
                  case 'error':
                    accumulated += `\n\n*Error: ${event.message}*`
                    setState((prev) => ({ ...prev, streamingContent: accumulated }))
                    break
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[Follow Chat] Stream error:', err)
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`,
            conversationId,
            role: 'assistant',
            content: `*Error: ${(err as Error).message || 'Failed to get response'}*`,
            createdAt: new Date(),
          }
          setMessages((prev) => [...prev, errorMsg])
        }
      } finally {
        setState({ isStreaming: false, streamingContent: '', toolStatus: null })
        abortRef.current = null
        onDone?.()
      }
    },
    [conversationId, onDone]
  )

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return {
    messages,
    streamingContent: state.streamingContent,
    toolStatus: state.toolStatus,
    isStreaming: state.isStreaming,
    sendMessage,
    stopStreaming,
    clearMessages,
    setMessages,
  }
}
