'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { ChatMessage as ChatMessageType, MessageAttachment } from '@workspace/shared/types'
import type { DocumentEdit } from '@/stores/local-provenance-store'
import type { AiAnnotation } from '@/stores/ai-annotation-store'
import { authFetch } from '@/lib/api-client'

interface UseSSEChatOptions {
  conversationId: string | null
  workspaceId: string
  onDone?: () => void
  /** Called when AI finishes streaming and content has draft intent — creates ghost draft in document */
  onGhostDraftContent?: (content: string, sourcePrompt: string) => void
  /** Called when AI returns annotations to apply to the document */
  onAnnotationContent?: (annotations: AiAnnotation[], summary: string) => void
}

export interface MessageSource {
  label: string
  type: string
  id?: string
}

interface SSEChatState {
  isStreaming: boolean
  streamingContent: string
  toolStatus: string | null
  /** Sources for the message currently being streamed (cleared when next user msg sent) */
  pendingSources: MessageSource[]
}

/** Friendly streaming labels for known tool calls. */
export const TOOL_LABELS: Record<string, string> = {
  search_files: '\uD83D\uDD0D Searching files...',
  read_file: '\uD83D\uDCC4 Reading document...',
  read_file_section: '\uD83D\uDCC4 Reading section...',
  create_file: '\uD83D\uDCDD Creating file...',
  list_files: '\uD83D\uDCC2 Listing files...',
  get_timeline_summary: '\uD83D\uDCCA Getting activity summary...',
  read_canvas: '\uD83C\uDFA8 Reading canvas...',
  read_notebook: '\uD83D\uDCD3 Reading notebook...',
  annotate_document: '\u270F\uFE0F Annotating document...',
  read_google_doc: '\uD83D\uDCC4 Reading Google Doc...',
  propose_document_edit: '\u270F\uFE0F Proposing edit...',
  annotate_google_doc: '\uD83D\uDCDD Annotating Google Doc...',
  edit_google_sheet: '\uD83D\uDCCA Editing spreadsheet...',
}

export function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? `Using ${tool}...`
}

/** Brief result label shown after a tool call finishes. */
export function getToolResultLabel(tool: string, result: unknown, durationMs?: number): string {
  const seconds = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null
  const r = (result ?? {}) as Record<string, unknown>

  let body: string
  if (tool === 'search_files' || tool === 'list_files') {
    const count = Array.isArray(r.files) ? (r.files as unknown[]).length : 0
    body = `Found ${count} file${count === 1 ? '' : 's'}`
  } else if (tool === 'read_file' || tool === 'read_file_section') {
    body = r.fileName ? `Read ${r.fileName}` : 'Read document'
  } else if (tool === 'get_timeline_summary') {
    const count = Array.isArray(r.events) ? (r.events as unknown[]).length : 0
    body = `${count} events`
  } else {
    body = 'Done'
  }
  return seconds ? `${body} (${seconds})` : body
}

/** Serializable edit for sending to the backend */
export interface SerializedDocumentEdit {
  editType: 'insertion' | 'deletion' | 'replacement'
  removedText: string
  addedText: string
  context: string
  time: string
}

/** Convert DocumentEdit[] to serializable format (strips id) */
export function serializeEdits(edits: DocumentEdit[]): SerializedDocumentEdit[] {
  return edits.map((e) => ({
    editType: e.editType,
    removedText: e.removedText,
    addedText: e.addedText,
    context: e.context,
    time: e.time,
  }))
}

/**
 * Detect whether the user's message is explicitly asking the AI to
 * write, draft, or compose content that should be offered as an
 * insertable draft card.  Only these "write-intent" messages produce
 * draft cards; normal Q&A / analysis responses do not.
 */
const DRAFT_INTENT_RE =
  /(write|draft|compose|rewrite|redraft|rephrase|generate|create|author|produce|add a paragraph|add a section|write me|draft me|can you write|please write|help me write)/i

export function hasDraftIntent(userMessage: string): boolean {
  return DRAFT_INTENT_RE.test(userMessage)
}

export function useSSEChat({
  conversationId,
  workspaceId: _workspaceId,
  onDone,
  onGhostDraftContent,
  onAnnotationContent,
}: UseSSEChatOptions) {
  const [state, setState] = useState<SSEChatState>({
    isStreaming: false,
    streamingContent: '',
    toolStatus: null,
    pendingSources: [],
  })
  const [localMessages, setLocalMessages] = useState<ChatMessageType[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // Keep a ref to the latest onGhostDraftContent so the sendMessage
  // closure always calls the current callback (avoids stale editor ref).
  const ghostDraftRef = useRef(onGhostDraftContent)
  useEffect(() => {
    ghostDraftRef.current = onGhostDraftContent
  }, [onGhostDraftContent])

  const annotationRef = useRef(onAnnotationContent)
  useEffect(() => {
    annotationRef.current = onAnnotationContent
  }, [onAnnotationContent])

  const sendMessage = useCallback(
    async (
      content: string,
      attachments: MessageAttachment[] = [],
      currentSection?: { index: number; title: string },
      documentContent?: string,
      recentDocumentEdits?: SerializedDocumentEdit[]
    ) => {
      if (!conversationId) return

      // Add optimistic user message
      const userMsg: ChatMessageType = {
        id: `temp-${Date.now()}`,
        conversationId,
        userId: 'self',
        role: 'user',
        content,
        richContent: null,
        attachments,
        metadata: {},
        parentMessageId: null,
        createdAt: new Date(),
      }
      setLocalMessages((prev) => [...prev, userMsg])

      // Start streaming
      setState({ isStreaming: true, streamingContent: '', toolStatus: null, pendingSources: [] })
      const controller = new AbortController()
      abortRef.current = controller
      let collectedSources: MessageSource[] = []

      try {
        const res = await authFetch(`/api/chat/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            attachments,
            currentSection,
            documentContent,
            recentDocumentEdits,
          }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          throw new Error('Failed to send message')
        }

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
                  case 'tool_end': {
                    // Briefly show a result label, then fade after 3s
                    const resultLabel = getToolResultLabel(
                      event.tool,
                      event.result,
                      event.durationMs
                    )
                    setState((prev) => ({ ...prev, toolStatus: resultLabel }))
                    setTimeout(() => {
                      setState((prev) =>
                        prev.toolStatus === resultLabel ? { ...prev, toolStatus: null } : prev
                      )
                    }, 3000)
                    break
                  }
                  case 'sources':
                    if (Array.isArray(event.sources)) {
                      collectedSources = event.sources as MessageSource[]
                      setState((prev) => ({
                        ...prev,
                        pendingSources: collectedSources,
                      }))
                    }
                    break
                  case 'annotations':
                    if (annotationRef.current && event.annotations) {
                      annotationRef.current(
                        event.annotations as AiAnnotation[],
                        event.summary ?? ''
                      )
                    }
                    break
                  case 'done':
                    // Add the final assistant message
                    if (accumulated) {
                      const assistantMsgId = event.messageId ?? `ai-${Date.now()}`
                      const assistantMsg: ChatMessageType = {
                        id: assistantMsgId,
                        conversationId,
                        userId: null,
                        role: 'assistant',
                        content: accumulated,
                        richContent: null,
                        attachments: [],
                        metadata: collectedSources.length > 0 ? { sources: collectedSources } : {},
                        parentMessageId: null,
                        createdAt: new Date(),
                      }
                      setLocalMessages((prev) => [...prev, assistantMsg])

                      // Sprint FE-4: post-stream metadata fetch.
                      // SSE 'done' only returns the messageId — the reference
                      // agent's versionCitations + agentIntent live on the
                      // persisted chat_messages.metadata jsonb. Fetch the
                      // conversation messages and patch the new message with
                      // any metadata the backend attached. Fire-and-forget so
                      // ghost-draft creation below still runs on the main path.
                      if (event.messageId && !String(event.messageId).startsWith('ai-')) {
                        void (async () => {
                          try {
                            const res = await authFetch(
                              `/api/chat/conversations/${conversationId}/messages?limit=20`,
                              { headers: { 'Content-Type': 'application/json' } }
                            )
                            if (!res.ok) return
                            const payload = (await res.json()) as {
                              data?: Array<{ id: string; metadata?: Record<string, unknown> }>
                            }
                            const latest = (payload.data ?? []).find(
                              (m) => m.id === event.messageId
                            )
                            if (latest?.metadata) {
                              setLocalMessages((prev) =>
                                prev.map((m) =>
                                  m.id === assistantMsgId
                                    ? {
                                        ...m,
                                        metadata: {
                                          ...(m.metadata as Record<string, unknown> | undefined),
                                          ...(latest.metadata as Record<string, unknown>),
                                        },
                                      }
                                    : m
                                )
                              )
                            }
                          } catch {
                            // Non-blocking — citations are a nice-to-have
                          }
                        })()
                      }

                      // Create an inline ghost draft when user explicitly asked AI to write/draft
                      if (
                        ghostDraftRef.current &&
                        accumulated.length > 50 &&
                        hasDraftIntent(content)
                      ) {
                        const trimmed = accumulated.trim()
                        const endsWithQuestion = trimmed.endsWith('?')
                        const startsWithError = trimmed.startsWith('*Error')
                        if (!endsWithQuestion && !startsWithError) {
                          ghostDraftRef.current(accumulated, content)
                        }
                      }
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
          console.error('[SSEChat] Stream error:', err)
          const errorMsg: ChatMessageType = {
            id: `error-${Date.now()}`,
            conversationId,
            userId: null,
            role: 'assistant',
            content: `*Error: ${(err as Error).message || 'Failed to get response'}*`,
            richContent: null,
            attachments: [],
            metadata: {},
            parentMessageId: null,
            createdAt: new Date(),
          }
          setLocalMessages((prev) => [...prev, errorMsg])
        }
      } finally {
        setState({ isStreaming: false, streamingContent: '', toolStatus: null, pendingSources: [] })
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
    setLocalMessages([])
  }, [])

  return {
    messages: localMessages,
    streamingContent: state.streamingContent,
    toolStatus: state.toolStatus,
    isStreaming: state.isStreaming,
    pendingSources: state.pendingSources,
    sendMessage,
    stopStreaming,
    clearMessages,
    setMessages: setLocalMessages,
  }
}
