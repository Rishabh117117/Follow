/**
 * Port of unit-chat-panel.tsx — messages, streaming, input.
 * Adapted for Chrome Extension context.
 *
 * The bottom bar (input + modes) is always visible.
 * The messages section smoothly expands/collapses above it.
 *
 * Mode buttons: Memory, Notes (Web and Doc removed — now feature toggles)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  useFloatingUnitStore,
  CHAT_PANEL_MIN_HEIGHT,
  CHAT_PANEL_MAX_HEIGHT_OFFSET,
  type ActiveMode,
} from '@/stores/floating-unit-store'
import { useChat, hasDraftIntent, detectAnalysisIntent, type ChatMessage, type AnnotationPayload, type DraftPreviewPayload, type AnalysisMode } from '@/hooks/useChat'
import { useApi } from '@/hooks/useApi'
import { UnitInputBar } from './UnitInputBar'
import { DraftCard } from './DraftCard'
import { COLORS, FLOATING_UNIT } from '@/lib/constants'
import type { GoogleDocType } from '@/lib/google-doc-utils'
import { getDocTitle, fetchDocumentText } from '@/content/dom-bridge'
import { useOverlayStore } from '@/stores/overlay-store'
import { useSmartDocStore } from '@/stores/smart-doc-store'

interface UnitChatPanelProps {
  googleDocId?: string
  docType?: GoogleDocType
}

const MODE_BUTTONS: { mode: ActiveMode; label: string }[] = [
  { mode: 'memory', label: 'Memory' },
  { mode: 'notes', label: 'Notes' },
]

// Sprint CTX-2: compact routing indicator for AI messages in the extension.
// Compact — just "Index" or "Directory" text plus a one-line contested flag.
interface RoutingIndicatorProps {
  queryType?: 'index' | 'directory'
  routingReason?: string
  contributors?: Array<{ userId: string; name: string }>
}
export function RoutingIndicator({ queryType, routingReason, contributors }: RoutingIndicatorProps) {
  if (!queryType) return null
  const isDir = queryType === 'directory'
  const contested = routingReason === 'contested'
  return (
    <div data-testid="routing-indicator" style={{ marginTop: 4, fontSize: 9, fontFamily: 'monospace' }}>
      <span
        data-testid="routing-indicator-label"
        style={{ color: isDir ? '#0e7490' : '#6C63FF', marginRight: 6 }}
      >
        {isDir ? 'Directory' : 'Index'}
      </span>
      {contested && (
        <span data-testid="routing-indicator-contested" style={{ color: '#d97706' }}>
          ⚡ Contested — showing sources
        </span>
      )}
      {isDir && contributors && contributors.length > 0 && (
        <span data-testid="routing-indicator-contributors" style={{ color: '#6b6358' }}>
          {' · '}
          {contributors.map((c) => c.name).join(', ')}
        </span>
      )}
    </div>
  )
}

export function UnitChatPanel({ googleDocId, docType }: UnitChatPanelProps) {
  const {
    panelState,
    activeMode,
    currentConversationId,
    currentConversationTitle,
    expandedHeight,
    threadDrawerOpen,
    attachedSources,
    setConversation,
    setExpandedHeight,
    setThreadDrawerOpen,
    setActiveMode,
    expand,
    collapse,
    minimize,
    removeSource,
  } = useFloatingUnitStore()

  const { post, get } = useApi()
  const followDocId = useSmartDocStore((s) => s.followDocId)
  const isSmartDocActive = useSmartDocStore((s) => s.isActivated)
  const signalCount = useSmartDocStore((s) => s.signalCount)

  const [inputValue, setInputValue] = useState('')
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([])
  const [draftCards, setDraftCards] = useState<{ id: string; content: string; prompt: string }[]>([])
  const [analysisActions, setAnalysisActions] = useState<{ id: string; mode: AnalysisMode; label: string }[]>([])
  const [analysisLoading, setAnalysisLoading] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingMessageRef = useRef<string>('')
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)

  const showMessages = panelState === 'expanded' && activeMode === 'chat'
  const messagesHeight = showMessages
    ? Math.max(expandedHeight - FLOATING_UNIT.BOTTOM_BAR_HEIGHT, 200)
    : 0

  // ─── Annotation handler ───
  const handleAnnotations = useCallback(async (annotations: AnnotationPayload[]) => {
    console.log(`[Follow] Received ${annotations.length} annotations → highlighting in doc + showing Insight Panel`)

    const items = annotations.map((a) => ({
      id: a.id,
      spanText: a.spanText,
      insight: a.insight || a.explanation || '',
      category: a.category,
      rating: a.rating ?? null,
      status: 'highlighted' as const,
    }))
    useOverlayStore.getState().setPendingAnnotations(items)

    if (googleDocId) {
      try {
        // Split annotations into those with formatting vs plain highlights
        const formatSpans = annotations
          .filter((a) => a.format)
          .map((a) => ({ spanText: a.spanText, format: a.format as 'underline' | 'bold' | 'italic' }))
        const highlightSpans = annotations
          .filter((a) => !a.format)
          .map((a) => ({ spanText: a.spanText, category: a.category }))

        // Apply text formatting (underline/bold/italic) if any
        if (formatSpans.length > 0) {
          const { formatTextInGoogleDoc } = await import('@/lib/google-docs-api')
          const fmtCount = await formatTextInGoogleDoc(googleDocId, formatSpans)
          console.log(`[Follow] Applied formatting to ${fmtCount}/${formatSpans.length} spans`)
        }

        // Apply background-color highlights for non-formatted annotations
        if (highlightSpans.length > 0) {
          const { highlightTextInGoogleDoc } = await import('@/lib/google-docs-api')
          const hlCount = await highlightTextInGoogleDoc(googleDocId, highlightSpans)
          console.log(`[Follow] Auto-highlighted ${hlCount}/${highlightSpans.length} annotations`)
        }
      } catch (err) {
        console.error('[Follow] Auto-highlight/format failed:', err)
      }
    }
  }, [googleDocId])

  // ─── Underline analysis handler (triggered by action button click) ───
  const triggerUnderlineAnalysis = useCallback(async (mode: AnalysisMode) => {
    if (analysisLoading) return
    setAnalysisLoading(true)

    try {
      // 1. Fetch document text
      const docText = await fetchDocumentText(googleDocId || '')
      if (!docText.trim()) {
        console.error('[Follow] Cannot analyze — empty document text')
        return
      }

      // 2. Call suggest API
      const MODE_TO_DOC_MODE: Record<AnalysisMode, string> = {
        grammar: 'edit_grammar',
        clarity: 'edit_clarity',
        conciseness: 'edit_conciseness',
        tone: 'edit_tone',
        structure: 'edit_structure',
      }

      // Use the full-document suggest endpoint directly for multiple suggestions
      const { STORAGE_KEYS, DEFAULT_API_BASE_URL } = await import('@/lib/constants')
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.AUTH_TOKEN,
        STORAGE_KEYS.USER_ID,
        STORAGE_KEYS.WORKSPACE_ID,
        STORAGE_KEYS.API_BASE_URL,
      ])
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = data[STORAGE_KEYS.AUTH_TOKEN] as string | undefined
      if (token) headers['Authorization'] = `Bearer ${token}`
      const userId = data[STORAGE_KEYS.USER_ID] as string | undefined
      if (userId) headers['x-user-id'] = userId
      const workspaceId = data[STORAGE_KEYS.WORKSPACE_ID] as string | undefined
      if (workspaceId) headers['x-workspace-id'] = workspaceId
      const baseUrl = (data[STORAGE_KEYS.API_BASE_URL] as string) || DEFAULT_API_BASE_URL

      const res = await fetch(`${baseUrl}/api/doc-intelligence-web/suggest`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: docText,
          mode: MODE_TO_DOC_MODE[mode],
        }),
      })

      if (!res.ok) throw new Error(`Suggest API failed: HTTP ${res.status}`)

      const json = await res.json()
      const suggestions = json.data?.suggestions ?? []

      if (suggestions.length === 0) {
        console.log('[Follow] No suggestions returned for analysis')
        return
      }

      // 3. Map suggestions to DocIntelMarks
      const { getParagraphTextsForMatching } = await import('@/content/dom-bridge')
      const { matchSpanToRange } = await import('@/lib/text-matcher')

      const paragraphTexts = getParagraphTextsForMatching()
      const TYPE_MAP: Record<AnalysisMode, import('@/stores/overlay-store').DocIntelType> = {
        grammar: 'grammar',
        clarity: 'clarity',
        conciseness: 'conciseness',
        tone: 'tone',
        structure: 'structure',
      }

      const newMarks: import('@/stores/overlay-store').DocIntelMark[] = []
      for (const sug of suggestions) {
        const range = matchSpanToRange(sug.spanText, paragraphTexts)
        if (range) {
          newMarks.push({
            id: sug.id || `mark-${Date.now()}-${newMarks.length}`,
            type: TYPE_MAP[mode],
            startPara: range.startPara,
            startChar: range.startChar,
            endPara: range.endPara,
            endChar: range.endChar,
            suggestion: sug.spanText || sug.originalText || '',
            replacement: sug.variants?.[0]?.text || sug.proposedText || sug.originalText || '',
            rects: [],
            dimmed: false,
          })
        }
      }

      // 4. Push to overlay store
      if (newMarks.length > 0) {
        useOverlayStore.getState().setMarks(newMarks)
        console.log(`[Follow] Underline analysis: ${newMarks.length} marks created for ${mode}`)
      }
    } catch (err) {
      console.error('[Follow] Underline analysis failed:', err)
    } finally {
      setAnalysisLoading(false)
    }
  }, [googleDocId, analysisLoading])

  // ─── Draft preview handler (inserts text into doc with blue highlight, then shows toolbar) ───
  const handleDraftPreview = useCallback(async (draft: DraftPreviewPayload) => {
    if (!googleDocId || !draft.newText) return
    console.log(`[Follow] Editor Agent: inserting draft (${draft.action}, ${draft.newText.length} chars)`)

    const { insertDraftText } = await import('@/lib/google-docs-api')
    const { addChatDraft } = useOverlayStore.getState()

    // Editor Agent: insert text into doc with blue highlight
    const result = await insertDraftText(googleDocId, draft.action, draft.newText, draft.findText ?? undefined)
    if (!result.success) {
      console.error('[Follow] Editor Agent: insert failed:', result.error)
      return
    }

    console.log(`[Follow] Editor Agent: inserted at [${result.startIndex}, ${result.endIndex}]`)

    // Track the draft in store (for toolbar UI)
    addChatDraft({
      googleDocId,
      action: draft.action,
      findText: draft.findText,
      summary: draft.summary || 'AI Edit',
      versions: [draft.newText],
      activeVersion: 0,
      status: 'ready',
      startIndex: result.startIndex,
      endIndex: result.endIndex,
    })
  }, [googleDocId])

  // ─── SSE Chat hook ───
  const {
    messages,
    streamingContent,
    toolStatus,
    isStreaming,
    sendMessage,
    stopStreaming,
    setMessages,
  } = useChat({
    conversationId: currentConversationId,
    onDone: () => {
      loadConversations()
    },
    onAnnotations: handleAnnotations,
    onDraftPreview: handleDraftPreview,
  })

  // ─── Load conversations ───
  const loadConversations = useCallback(async () => {
    const result = await get<{ id: string; title: string }[]>('/api/chat/conversations')
    if (result.data) {
      setConversations(Array.isArray(result.data) ? result.data : [])
    }
  }, [get])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Fetch document text on mount
  useEffect(() => {
    if (googleDocId) fetchDocumentText(googleDocId)
  }, [googleDocId])

  // Auto-select first conversation
  useEffect(() => {
    if (!currentConversationId && conversations.length > 0) {
      setConversation(conversations[0]!.id, conversations[0]!.title)
    }
  }, [currentConversationId, conversations, setConversation])

  // Load existing messages when conversation changes
  useEffect(() => {
    if (!currentConversationId) return
    const loadMessages = async () => {
      const result = await get<ChatMessage[]>(
        `/api/chat/conversations/${currentConversationId}/messages`
      )
      if (result.data) {
        setMessages(Array.isArray(result.data) ? result.data : [])
      }
    }
    loadMessages()
  }, [currentConversationId, get, setMessages])

  // Send pending message when conversation becomes available
  useEffect(() => {
    if (currentConversationId && pendingMessageRef.current) {
      const pending = pendingMessageRef.current
      pendingMessageRef.current = ''
      // Always fetch fresh document text (canvas-mode Docs need async fetch)
      fetchDocumentText(googleDocId || '').then((docContent) => {
        console.log(`[Follow] Sending message with documentContent: ${docContent.length} chars`)
        sendMessage(pending, {
          googleDocId: googleDocId || '',
          docType: docType || 'docs',
          docTitle: getDocTitle(),
          documentContent: docContent,
        })
      })
    }
  }, [currentConversationId, sendMessage, googleDocId, docType])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent])

  // Check for draft intent in streamed responses
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
      if (lastUser && lastAssistant && hasDraftIntent(lastUser.content) && lastAssistant.content.length > 50) {
        const trimmed = lastAssistant.content.trim()
        if (!trimmed.endsWith('?') && !trimmed.startsWith('*Error')) {
          setDraftCards((prev) => [
            ...prev,
            {
              id: `draft-${Date.now()}`,
              content: lastAssistant.content,
              prompt: lastUser.content,
            },
          ])
        }
      }
    }
  }, [isStreaming, messages])

  // Check for analysis intent in streamed responses → show action button
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      if (lastUser) {
        const { hasIntent, mode } = detectAnalysisIntent(lastUser.content)
        if (hasIntent) {
          const MODE_LABELS: Record<AnalysisMode, string> = {
            grammar: 'Underline grammar issues',
            clarity: 'Underline clarity issues',
            conciseness: 'Underline conciseness issues',
            tone: 'Underline tone issues',
            structure: 'Underline structure issues',
          }
          setAnalysisActions((prev) => {
            // Avoid duplicates for same message
            const existingIds = new Set(prev.map((a) => a.id))
            const newId = `analysis-${lastUser.id}`
            if (existingIds.has(newId)) return prev
            return [...prev, { id: newId, mode, label: MODE_LABELS[mode] }]
          })
        }
      }
    }
  }, [isStreaming, messages])

  // ─── Drag-to-resize ───
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      dragStartYRef.current = e.clientY
      dragStartHeightRef.current = expandedHeight

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return
        const delta = dragStartYRef.current - ev.clientY
        const maxH = window.innerHeight - CHAT_PANEL_MAX_HEIGHT_OFFSET
        setExpandedHeight(
          Math.max(CHAT_PANEL_MIN_HEIGHT, Math.min(dragStartHeightRef.current + delta, maxH))
        )
      }

      const onUp = () => {
        isDraggingRef.current = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [expandedHeight, setExpandedHeight]
  )

  // ─── Handlers ───
  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return
    if (!showMessages) {
      expand()
      setActiveMode('chat')
    }
    if (!currentConversationId) {
      pendingMessageRef.current = inputValue
      // Create new conversation with GWS context
      post<{ id: string; title: string }>('/api/chat/conversations', {
        title: 'New Chat',
        type: 'standard',
        ...(followDocId ? { contextObjectId: followDocId, contextObjectType: 'external_document' } : {}),
      }).then((result) => {
        if (result.data) {
          setConversation(result.data.id, result.data.title)
          loadConversations()
        }
      })
    } else {
      // Always fetch fresh document text (canvas-mode Docs need async fetch)
      const msg = inputValue
      fetchDocumentText(googleDocId || '').then((docContent) => {
        console.log(`[Follow] Direct send with documentContent: ${docContent.length} chars`)
        sendMessage(msg, {
          googleDocId: googleDocId || '',
          docType: docType || 'docs',
          docTitle: getDocTitle(),
          documentContent: docContent,
        })
      })
    }
    setInputValue('')
  }, [inputValue, showMessages, currentConversationId, sendMessage, expand, setActiveMode, post, setConversation, loadConversations, googleDocId, docType, followDocId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleInputClick = useCallback(() => {
    if (!showMessages && !inputValue.trim()) {
      expand()
      setActiveMode('chat')
    }
  }, [showMessages, inputValue, expand, setActiveMode])

  const handleModeClick = useCallback(
    (mode: ActiveMode) => {
      if (activeMode === mode) {
        setActiveMode('chat')
        collapse()
      } else {
        setActiveMode(mode)
        expand()
      }
    },
    [activeMode, setActiveMode, expand, collapse]
  )

  const handleNewChat = useCallback(async () => {
    const result = await post<{ id: string; title: string }>('/api/chat/conversations', {
      title: 'New Chat',
      type: 'standard',
      ...(followDocId ? { contextObjectId: followDocId, contextObjectType: 'external_document' } : {}),
    })
    if (result.data) {
      setConversation(result.data.id, result.data.title)
      setMessages([])
      setDraftCards([])
      loadConversations()
    }
    setThreadDrawerOpen(false)
  }, [post, setConversation, setMessages, loadConversations, setThreadDrawerOpen, followDocId])

  const handleSelectConversation = useCallback(
    (convId: string, title: string) => {
      setConversation(convId, title)
      setThreadDrawerOpen(false)
    },
    [setConversation, setThreadDrawerOpen]
  )

  const chatTitle = currentConversationTitle || 'New Chat'

  // ─── Shadow ───
  const cardShadow = showMessages
    ? '0 12px 48px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.05)'
    : '0 4px 20px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.03)'

  return (
    <div
      className="follow-interactive"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: FLOATING_UNIT.COLLAPSED_WIDTH,
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          boxShadow: cardShadow,
          overflow: 'hidden',
          transition: 'box-shadow 400ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* ═══ MESSAGES SECTION ═══ */}
        <div
          style={{
            height: messagesHeight,
            transition: 'height 400ms cubic-bezier(0.22, 1, 0.36, 1)',
            overflow: 'hidden',
            willChange: showMessages ? 'height' : undefined,
          }}
        >
          <div
            style={{
              height: Math.max(expandedHeight - FLOATING_UNIT.BOTTOM_BAR_HEIGHT, 200),
              display: 'flex',
              flexDirection: 'column',
              opacity: showMessages ? 1 : 0,
              transform: showMessages ? 'translateY(0)' : 'translateY(12px)',
              transition: 'opacity 350ms ease, transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Drag handle */}
            <div
              onMouseDown={handleDragStart}
              style={{
                height: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'ns-resize',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 3,
                  borderRadius: 2,
                  background: COLORS.borderDivider,
                }}
              />
            </div>

            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px',
                borderBottom: `1px solid ${COLORS.borderLight}`,
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => setThreadDrawerOpen(!threadDrawerOpen)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title={threadDrawerOpen ? 'Close history' : 'Chat history'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.textSecondary} strokeWidth="2">
                    {threadDrawerOpen ? (
                      <path d="M15 19l-7-7 7-7" />
                    ) : (
                      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    )}
                  </svg>
                </button>
                <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.text }}>
                  {chatTitle}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={handleNewChat}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 12px',
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: 500,
                    color: COLORS.blue,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  New
                </button>
                <button
                  onClick={() => collapse()}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Close chat"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.textSecondary} strokeWidth="2">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body: messages + drawer overlay */}
            <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
              {/* Thread drawer backdrop */}
              {threadDrawerOpen && (
                <div
                  onClick={() => setThreadDrawerOpen(false)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.1)',
                    zIndex: 10,
                  }}
                />
              )}

              {/* Thread drawer */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: 280,
                  background: COLORS.surface,
                  zIndex: 20,
                  transform: threadDrawerOpen ? 'translateX(0)' : 'translateX(-100%)',
                  transition: 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)',
                  borderRight: `1px solid ${COLORS.borderLight}`,
                  boxShadow: threadDrawerOpen ? '4px 0 20px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Chat History</span>
                  <button onClick={() => setThreadDrawerOpen(false)} style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.textSecondary} strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                  {conversations.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: '24px 12px', fontSize: 12, color: COLORS.textTertiary }}>
                      No conversations yet.
                    </p>
                  ) : (
                    conversations.map((conv) => {
                      const isActive = conv.id === currentConversationId
                      return (
                        <button
                          key={conv.id}
                          onClick={() => handleSelectConversation(conv.id, conv.title)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '10px 12px',
                            borderRadius: 8,
                            textAlign: 'left',
                            marginBottom: 4,
                            background: isActive ? COLORS.blueLight : 'transparent',
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isActive ? COLORS.blue : COLORS.textTertiary} strokeWidth="1.5">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
                          <span style={{
                            flex: 1,
                            fontSize: 13,
                            color: isActive ? COLORS.blue : '#3C4043',
                            fontWeight: isActive ? 600 : 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {conv.title || 'Untitled'}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
                <div style={{ padding: 8, borderTop: `1px solid ${COLORS.borderLight}` }}>
                  <button
                    onClick={handleNewChat}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '8px 0',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 500,
                      color: COLORS.blue,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                    New Chat
                  </button>
                </div>
              </div>

              {/* Main messages area */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                  {messages.length === 0 && !isStreaming && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: COLORS.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>F</div>
                      <p style={{ fontSize: 13, fontWeight: 500, color: COLORS.text }}>How can I help?</p>
                      <p style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 4 }}>Ask anything about your document.</p>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {messages.map((msg) => (
                      <div key={msg.id} style={{ display: 'flex', gap: 12, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.role === 'assistant' && (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: COLORS.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>F</div>
                        )}
                        <div
                          className="follow-chat-markdown"
                          style={{
                            maxWidth: '80%',
                            borderRadius: 16,
                            padding: '10px 16px',
                            fontSize: 13,
                            lineHeight: 1.6,
                            background: msg.role === 'user' ? COLORS.blueLight : COLORS.surfaceHover,
                            color: COLORS.text,
                          }}
                          dangerouslySetInnerHTML={msg.role === 'assistant' ? { __html: simpleMarkdown(msg.content) } : undefined}
                        >
                          {msg.role === 'user' ? msg.content : undefined}
                        </div>
                      </div>
                    ))}
                    {isStreaming && (
                      <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: COLORS.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>F</div>
                        <div className="follow-chat-markdown" style={{ borderRadius: 16, padding: '10px 16px', fontSize: 13, background: COLORS.surfaceHover, color: '#3C4043' }}>
                          {toolStatus && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.primary, marginBottom: 6 }}>
                              <span className="follow-animate-spin" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent' }} />
                              {toolStatus}
                            </div>
                          )}
                          {streamingContent && (
                            <span dangerouslySetInnerHTML={{ __html: simpleMarkdown(streamingContent) }} />
                          )}
                          <span className="follow-animate-pulse" style={{ display: 'inline-block', width: 2, height: 16, background: COLORS.primary, marginLeft: 2 }} />
                        </div>
                      </div>
                    )}
                    {/* Draft cards */}
                    {draftCards.map((card) => (
                      <DraftCard
                        key={card.id}
                        content={card.content}
                        onInsert={() => {
                          setDraftCards((prev) => prev.filter((d) => d.id !== card.id))
                        }}
                        onCopy={() => {
                          navigator.clipboard.writeText(card.content)
                        }}
                        onDismiss={() => {
                          setDraftCards((prev) => prev.filter((d) => d.id !== card.id))
                        }}
                      />
                    ))}
                    {/* Analysis action buttons */}
                    {analysisActions.map((action) => (
                      <div
                        key={action.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 12px',
                          borderRadius: 12,
                          border: '1px solid #E0E7FF',
                          background: '#EEF2FF',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2">
                          <path d="M4 7h16M4 12h16M4 17h10" />
                        </svg>
                        <button
                          onClick={() => {
                            triggerUnderlineAnalysis(action.mode)
                            setAnalysisActions((prev) => prev.filter((a) => a.id !== action.id))
                          }}
                          disabled={analysisLoading}
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: analysisLoading ? '#9CA3AF' : '#4F46E5',
                            background: 'none',
                            border: 'none',
                            cursor: analysisLoading ? 'wait' : 'pointer',
                            padding: 0,
                          }}
                        >
                          {analysisLoading ? 'Analyzing document...' : action.label}
                        </button>
                        {!analysisLoading && (
                          <button
                            onClick={() => setAnalysisActions((prev) => prev.filter((a) => a.id !== action.id))}
                            style={{
                              marginLeft: 'auto',
                              fontSize: 12,
                              color: '#9CA3AF',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ BOTTOM BAR ═══ */}
        <div style={{
          borderTop: `1px solid ${showMessages ? COLORS.borderLight : 'transparent'}`,
          transition: 'border-color 300ms ease',
        }}>
          <UnitInputBar
            inputValue={inputValue}
            onInputChange={setInputValue}
            onKeyDown={handleKeyDown}
            onInputClick={handleInputClick}
            onSend={handleSend}
            onStop={stopStreaming}
            onMinimize={minimize}
            isStreaming={isStreaming}
          />

          {/* Mode buttons | sources row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {MODE_BUTTONS.map(({ mode, label }) => {
                const isActive = activeMode === mode
                return (
                  <button
                    key={mode}
                    onClick={() => handleModeClick(mode)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 8,
                      fontSize: 12,
                      transition: 'all 200ms ease',
                      background: isActive ? COLORS.blueLight : 'transparent',
                      color: isActive ? COLORS.blue : COLORS.textSecondary,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            <div style={{ width: 1, height: 16, background: COLORS.borderLight, margin: '0 6px' }} />

            {/* Document status indicator */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 99,
                fontSize: 11,
                background: isSmartDocActive ? '#DCFCE7' : COLORS.surfaceHover,
                color: isSmartDocActive ? '#166534' : COLORS.textTertiary,
              }}
              title={isSmartDocActive ? `Document active (${signalCount} signals)` : 'Document not active'}
            >
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isSmartDocActive ? '#22C55E' : '#9CA3AF',
              }} />
              {isSmartDocActive ? 'Document' : 'Not linked'}
            </span>

            {/* Attached sources */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {attachedSources.map((source) => (
                <span
                  key={source.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 99,
                    fontSize: 11,
                    background: COLORS.surfaceHover,
                    color: '#3C4043',
                  }}
                >
                  {source.label}
                  <button onClick={() => removeSource(source.id)} style={{ color: COLORS.textTertiary, fontSize: 12 }}>&times;</button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Minimal markdown → HTML converter for chat messages (no external dep) */
function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}
