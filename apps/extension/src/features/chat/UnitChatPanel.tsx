/**
 * UnitChatPanel — full chat panel with messages, streaming, thread drawer.
 *
 * The bottom bar (input + modes) is always visible.
 * The messages section smoothly expands/collapses above it.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  useFloatingUnitStore,
  CHAT_PANEL_MIN_HEIGHT,
  CHAT_PANEL_MAX_HEIGHT_OFFSET,
} from '../../stores/floating-unit-store'
import { useChat, type ChatMessage } from './use-chat'
import { UnitInputBar } from './UnitInputBar'
import { DraftCard } from './DraftCard'
import { COLORS, FLOATING_UNIT } from '../../lib/constants'
import { getAuth } from '../../core/storage'
import {
  extractGoogleDocId,
  highlightSuggestionsInGoogleDoc,
  highlightFindingsInGoogleDoc,
  scrollToTextInGoogleDoc,
} from '../../lib/google-docs-api'

export function UnitChatPanel() {
  const {
    panelState,
    activeMode,
    currentConversationId,
    currentConversationTitle,
    expandedHeight,
    threadDrawerOpen,
    setConversation,
    setExpandedHeight,
    setThreadDrawerOpen,
    setActiveMode,
    expand,
    collapse,
    minimize,
  } = useFloatingUnitStore()

  const [inputValue, setInputValue] = useState('')
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([])
  const [draftCards, setDraftCards] = useState<{ id: string; content: string }[]>([])
  const [docContext, setDocContext] = useState<{ title: string; url: string; docId: string; content?: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingMessageRef = useRef<string>('')
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)

  const showMessages = panelState === 'expanded' && activeMode === 'chat'
  const messagesHeight = showMessages
    ? Math.max(expandedHeight - FLOATING_UNIT.BOTTOM_BAR_HEIGHT, 200)
    : 0

  // ─── Handle annotations from AI → highlight in Google Doc ───
  const handleAnnotations = useCallback((annotations: unknown[]) => {
    const docId = extractGoogleDocId()
    if (!docId || !Array.isArray(annotations) || annotations.length === 0) return

    // Map annotations to highlight calls
    const items = annotations as Array<{
      spanText?: string; category?: string; insight?: string; explanation?: string; severity?: string
    }>

    // Determine if these are suggestion-style or finding-style annotations
    const hasSeverity = items.some(a => a.severity)

    if (hasSeverity) {
      highlightFindingsInGoogleDoc(
        docId,
        items.filter(a => a.spanText).map(a => ({
          spanText: a.spanText!,
          severity: a.severity || 'info',
        }))
      ).then(count => {
        console.log(`[Follow Chat] Highlighted ${count} findings in Google Doc`)
      }).catch(err => {
        console.error('[Follow Chat] Failed to highlight findings:', err)
      })
    } else {
      highlightSuggestionsInGoogleDoc(
        docId,
        items.filter(a => a.spanText).map(a => ({
          spanText: a.spanText!,
          suggestionType: a.category || 'important',
        }))
      ).then(count => {
        console.log(`[Follow Chat] Highlighted ${count} annotations in Google Doc`)
      }).catch(err => {
        console.error('[Follow Chat] Failed to highlight annotations:', err)
      })
    }

    // Scroll to first annotation
    const first = items.find(a => a.spanText)
    if (first?.spanText) {
      setTimeout(() => scrollToTextInGoogleDoc(first.spanText!), 1500)
    }
  }, [])

  // ─── Handle draft preview from AI → show ghost draft inline in Google Doc ───
  const handleDraftPreview = useCallback((draft: { action: string; findText: string | null; newText: string }) => {
    if (!draft.newText) return

    // Determine anchor position: find the paragraph after findText, or end of doc
    let anchorIndex = -1 // -1 means append at end
    if (draft.findText) {
      const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
      for (let i = 0; i < paragraphs.length; i++) {
        const text = paragraphs[i]?.textContent || ''
        if (text.includes(draft.findText) || text.toLowerCase().includes(draft.findText.toLowerCase())) {
          anchorIndex = i
          break
        }
      }
    }

    if (anchorIndex === -1) {
      // Default to last paragraph
      const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
      anchorIndex = Math.max(0, paragraphs.length - 1)
    }

    // Dispatch event for the ai-writing feature to pick up and render a GhostDraft
    document.dispatchEvent(new CustomEvent('follow-create-ghost-draft', {
      detail: {
        id: `ghost-${Date.now()}`,
        anchorIndex,
        content: draft.newText,
        action: draft.action,
        findText: draft.findText,
        status: 'ready',
      },
    }))

    // Minimize the chat panel to show the ghost draft
    collapse()
  }, [collapse])

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
    onDone: () => { loadConversations() },
    onAnnotations: handleAnnotations,
    onDraftPreview: handleDraftPreview,
  })

  // ─── Detect current page context (GWS docs OR regular web pages) ───
  useEffect(() => {
    const url = window.location.href
    const gwsMatch = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/)
    if (gwsMatch) {
      const docId = gwsMatch[2]!
      const title = document.title.replace(/ - Google (Docs|Sheets|Slides)$/, '')
      setDocContext({ title, url, docId })

      // Fetch document content via Google Docs API (works in canvas mode too)
      import('../../content/dom-bridge').then(({ fetchDocumentText, getDocumentText }) => {
        // Try cached DOM text first
        const domText = getDocumentText()
        if (domText.trim()) {
          setDocContext(prev => prev ? { ...prev, content: domText.slice(0, 32000) } : prev)
          return
        }
        // Fetch via API
        fetchDocumentText(docId).then(text => {
          if (text.trim()) {
            setDocContext(prev => prev ? { ...prev, content: text.slice(0, 32000) } : prev)
          }
        }).catch(() => {})
      }).catch(() => {})
    } else {
      // Regular web page — extract visible text content for chat context
      const title = document.title
      const domain = window.location.hostname
      // Extract main content text (prefer <main>, <article>, then <body>)
      const mainEl = document.querySelector('main') || document.querySelector('article') || document.body
      const textContent = mainEl?.innerText?.slice(0, 16000) || ''
      if (title || textContent) {
        setDocContext({
          title: title || domain,
          url,
          docId: `web-${domain}`,
          content: `[Web Page: ${title}]\n[URL: ${url}]\n[Domain: ${domain}]\n\n${textContent}`.slice(0, 32000),
        })
      }
    }
  }, [])

  // ─── Load conversations ───
  const loadConversations = useCallback(async () => {
    try {
      const auth = await getAuth()
      if (!auth.userId || !auth.apiBaseUrl) return

      const res = await fetch(
        `${auth.apiBaseUrl}/api/chat/conversations?workspaceId=${auth.workspaceId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': auth.userId,
            'x-workspace-id': auth.workspaceId ?? '',
          },
        }
      )
      if (res.ok) {
        const json = await res.json()
        const data = json.data ?? json
        if (Array.isArray(data)) {
          setConversations(data.map((c: any) => ({ id: c.id, title: c.title || 'Untitled' })))
        }
      }
    } catch (err) {
      console.warn('[Follow] Failed to load conversations:', err)
    }
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  // Auto-select first conversation
  useEffect(() => {
    if (!currentConversationId && conversations.length > 0) {
      setConversation(conversations[0]!.id, conversations[0]!.title)
    }
  }, [currentConversationId, conversations, setConversation])

  // Load messages when conversation changes
  useEffect(() => {
    if (!currentConversationId) return
    const load = async () => {
      try {
        const auth = await getAuth()
        if (!auth.apiBaseUrl) return
        const res = await fetch(
          `${auth.apiBaseUrl}/api/chat/conversations/${currentConversationId}/messages`,
          {
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': auth.userId ?? '',
              'x-workspace-id': auth.workspaceId ?? '',
            },
          }
        )
        if (res.ok) {
          const json = await res.json()
          const data = json.data ?? json
          if (Array.isArray(data)) setMessages(data)
        }
      } catch {}
    }
    load()
  }, [currentConversationId, setMessages])

  // Send pending message when conversation becomes available
  useEffect(() => {
    if (currentConversationId && pendingMessageRef.current) {
      const metadata: Record<string, unknown> = { source: 'web_extension' }
      if (docContext) {
        metadata.documentContent = docContext.content
        metadata.attachments = [{
          type: 'text' as const,
          metadata: { url: docContext.url, title: docContext.title },
        }]
      }
      sendMessage(pendingMessageRef.current, metadata)
      pendingMessageRef.current = ''
    }
  }, [currentConversationId, sendMessage, docContext])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent])

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
        setExpandedHeight(Math.max(CHAT_PANEL_MIN_HEIGHT, Math.min(dragStartHeightRef.current + delta, maxH)))
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
  const handleSend = useCallback(async () => {
    if (!inputValue.trim()) return
    if (!showMessages) {
      expand()
      setActiveMode('chat')
    }
    if (!currentConversationId) {
      pendingMessageRef.current = inputValue
      try {
        const auth = await getAuth()
        if (!auth.apiBaseUrl) return

        const res = await fetch(`${auth.apiBaseUrl}/api/chat/conversations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': auth.userId ?? '',
            'x-workspace-id': auth.workspaceId ?? '',
          },
          body: JSON.stringify({
            workspaceId: auth.workspaceId,
            title: docContext?.title || 'New Chat',
            type: 'standard',
          }),
        })
        if (res.ok) {
          const json = await res.json()
          const data = json.data ?? json
          setConversation(data.id, data.title)
          loadConversations()
        }
      } catch (err) {
        console.error('[Follow] Failed to create conversation:', err)
      }
    } else {
      const metadata: Record<string, unknown> = { source: 'web_extension' }
      if (docContext) {
        metadata.documentContent = docContext.content
        metadata.attachments = [{
          type: 'text' as const,
          metadata: { url: docContext.url, title: docContext.title },
        }]
      }
      sendMessage(inputValue, metadata)
    }
    setInputValue('')
  }, [inputValue, showMessages, currentConversationId, sendMessage, expand, setActiveMode, setConversation, loadConversations, docContext])

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

  const handleNewChat = useCallback(async () => {
    try {
      const auth = await getAuth()
      if (!auth.apiBaseUrl) return

      const res = await fetch(`${auth.apiBaseUrl}/api/chat/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': auth.userId ?? '',
          'x-workspace-id': auth.workspaceId ?? '',
        },
        body: JSON.stringify({
          workspaceId: auth.workspaceId,
          title: docContext?.title || 'New Chat',
          type: 'standard',
        }),
      })
      if (res.ok) {
        const json = await res.json()
        const data = json.data ?? json
        setConversation(data.id, data.title)
        setMessages([])
        setDraftCards([])
        loadConversations()
      }
    } catch {}
    setThreadDrawerOpen(false)
  }, [setConversation, setMessages, loadConversations, setThreadDrawerOpen])

  const handleSelectConversation = useCallback(
    (convId: string, title: string) => {
      setConversation(convId, title)
      setThreadDrawerOpen(false)
    },
    [setConversation, setThreadDrawerOpen]
  )

  const chatTitle = currentConversationTitle || 'New Chat'

  const cardShadow = showMessages
    ? '0 12px 48px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.05)'
    : '0 4px 20px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.03)'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483646,
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
                height: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'ns-resize', flexShrink: 0,
              }}
            >
              <div style={{ width: 40, height: 3, borderRadius: 2, background: COLORS.borderDivider }} />
            </div>

            {/* Header */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 16px', borderBottom: `1px solid ${COLORS.borderLight}`, flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => setThreadDrawerOpen(!threadDrawerOpen)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', background: 'transparent', cursor: 'pointer',
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
                <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.text }}>{chatTitle}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={handleNewChat}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500,
                    color: COLORS.blue, border: 'none', background: 'transparent', cursor: 'pointer',
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
                    width: 28, height: 28, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', background: 'transparent', cursor: 'pointer',
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
                  style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.1)', zIndex: 10 }}
                />
              )}

              {/* Thread drawer */}
              <div
                style={{
                  position: 'absolute', top: 0, bottom: 0, left: 0, width: 280,
                  background: COLORS.surface, zIndex: 20,
                  transform: threadDrawerOpen ? 'translateX(0)' : 'translateX(-100%)',
                  transition: 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)',
                  borderRight: `1px solid ${COLORS.borderLight}`,
                  boxShadow: threadDrawerOpen ? '4px 0 20px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex', flexDirection: 'column',
                }}
              >
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Chat History</span>
                  <button
                    onClick={() => setThreadDrawerOpen(false)}
                    style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}
                  >
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
                            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px', borderRadius: 8, textAlign: 'left', marginBottom: 4,
                            background: isActive ? COLORS.blueLight : 'transparent',
                            border: 'none', cursor: 'pointer',
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isActive ? COLORS.blue : COLORS.textTertiary} strokeWidth="1.5">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
                          <span style={{
                            flex: 1, fontSize: 13,
                            color: isActive ? COLORS.blue : '#3C4043',
                            fontWeight: isActive ? 600 : 400,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 500,
                      color: COLORS.blue, border: 'none', background: 'transparent', cursor: 'pointer',
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
                      <p style={{ fontSize: 13, fontWeight: 500, color: COLORS.text, margin: 0 }}>How can I help?</p>
                      <p style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 4 }}>Ask anything about your work.</p>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {messages.map((msg) => (
                      <div key={msg.id} style={{ display: 'flex', gap: 12, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.role === 'assistant' && (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: COLORS.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>F</div>
                        )}
                        <div
                          style={{
                            maxWidth: '80%', borderRadius: 16, padding: '10px 16px',
                            fontSize: 13, lineHeight: 1.6,
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
                        <div style={{ borderRadius: 16, padding: '10px 16px', fontSize: 13, background: COLORS.surfaceHover, color: '#3C4043' }}>
                          {toolStatus && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.primary, marginBottom: 6 }}>
                              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', animation: 'follow-spin 0.8s linear infinite' }} />
                              {toolStatus}
                            </div>
                          )}
                          {streamingContent && (
                            <span dangerouslySetInnerHTML={{ __html: simpleMarkdown(streamingContent) }} />
                          )}
                          <span style={{ display: 'inline-block', width: 2, height: 16, background: COLORS.primary, marginLeft: 2, animation: 'follow-pulse 1s ease-in-out infinite' }} />
                        </div>
                      </div>
                    )}
                    {draftCards.map((card) => (
                      <DraftCard
                        key={card.id}
                        content={card.content}
                        onInsert={() => setDraftCards((prev) => prev.filter((d) => d.id !== card.id))}
                        onCopy={() => navigator.clipboard.writeText(card.content)}
                        onDismiss={() => setDraftCards((prev) => prev.filter((d) => d.id !== card.id))}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ BOTTOM BAR ═══ */}
        <div style={{ borderTop: `1px solid ${showMessages ? COLORS.borderLight : 'transparent'}`, transition: 'border-color 300ms ease' }}>
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
        </div>
      </div>
    </div>
  )
}

function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headings (### Title)
    .replace(/^#{1,4}\s+(.+)$/gm, '<strong style="display:block;margin:8px 0 4px">$1</strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
    // Bullet lists (- item or * item)
    .replace(/^\s*[-*]\s+(.+)$/gm, '<div style="padding-left:12px">&#8226; $1</div>')
    // Numbered lists (1. item)
    .replace(/^\s*(\d+)\.\s+(.+)$/gm, '<div style="padding-left:12px">$1. $2</div>')
    // Line breaks
    .replace(/\n/g, '<br>')
    // Clean up double <br> after block elements
    .replace(/(<\/div>)<br>/g, '$1')
    .replace(/(<\/strong>)<br>/g, '$1')
}
