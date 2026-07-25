'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api-client'
import { ConversationMenu } from './conversation-menu'
import { RichContentBlock } from '@/components/follow/common/rich-content-block'
import { GroupCreateModal } from '@/components/follow/modals/group-create-modal'
import {
  useFloatingUnitStore,
  CHAT_PANEL_MIN_HEIGHT,
  CHAT_PANEL_MAX_HEIGHT_OFFSET,
  type UnitActiveMode,
} from '@/stores/floating-unit-store'
import { useSSEChat, serializeEdits } from '@/hooks/use-sse-chat'
import { GroupChatPanel } from './group-chat-panel'
import { useEditorRefStore } from '@/stores/editor-ref-store'
import { useGhostDraftStore } from '@/stores/ghost-draft-store'
import { LiveContextBlock } from '@/components/follow/live-context/live-context-block'
import {
  useDocThreadsStore,
  conversationToThread,
  type DocThreadType,
} from '@/stores/doc-threads-store'
import { useGroupThreadStore } from '@/stores/group-thread-store'
import { ChatMarkdown } from './chat-markdown'
import { VersionCitation } from '@/components/follow/provenance/version-citation'
import { PasscodeDialog } from '@/components/follow/sharing/passcode-dialog'
import { useSharingStore } from '@/stores/sharing-store'
import type { ChatConversation, ChatMessage as ChatMessageType } from '@workspace/shared/types'
import { useLocalProvenanceStore } from '@/stores/local-provenance-store'
import { useAiAnnotationStore } from '@/stores/ai-annotation-store'
import { useEditorTabsStore } from '@/stores/editor-tabs-store'

interface WorkspaceFile {
  id: string
  name: string
  mimeType?: string
  metadata?: Record<string, unknown>
}

interface UnitChatPanelProps {
  workspaceId: string
}

/**
 * Extract the text content for the active tab (H1 section) from the TipTap editor.
 * Returns only the content between the active tab's H1 heading and the next H1 (or end of doc).
 * Falls back to full editor text if tabs are not in use or extraction fails.
 */
function getActiveTabContent(
  editor: {
    getText: () => string
    state: {
      doc: {
        descendants: (
          fn: (
            node: { type: { name: string }; attrs: Record<string, unknown>; textContent: string },
            pos: number
          ) => boolean | void
        ) => void
        textBetween: (from: number, to: number) => string
        content: { size: number }
      }
    }
  } | null,
  activeTabIndex: number,
  tabCount: number
): string | undefined {
  if (!editor) return undefined
  // Single tab or no tabs — return full text
  if (tabCount <= 1) return editor.getText()

  // Find positions of all H1 headings
  const h1Positions: { pos: number; size: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level === 1) {
      h1Positions.push({ pos, size: (node as unknown as { nodeSize: number }).nodeSize })
    }
    return true
  })

  if (activeTabIndex >= h1Positions.length) return editor.getText()

  const start = h1Positions[activeTabIndex]!.pos
  const end =
    activeTabIndex + 1 < h1Positions.length
      ? h1Positions[activeTabIndex + 1]!.pos
      : editor.state.doc.content.size

  try {
    return (
      editor.state.doc.textBetween as (from: number, to: number, blockSeparator?: string) => string
    )(start, end, '\n')
  } catch {
    return editor.getText()
  }
}

/** Height of the always-visible bottom bar (input row + mode row) */
const BOTTOM_BAR_HEIGHT = 92

const MODE_BUTTONS: { mode: UnitActiveMode; icon: string; label: string }[] = [
  { mode: 'web', icon: '\uD83C\uDF10', label: 'Web' },
  { mode: 'doc', icon: '\uD83D\uDCC4', label: 'Doc' },
  { mode: 'memory', icon: '\uD83D\uDCCA', label: 'Memory' },
  { mode: 'notes', icon: '\uD83D\uDCDD', label: 'Notes' },
]

const TYPE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  standard: { label: 'Chat', color: '#5F6368', bg: '#F1F3F4' },
  group: { label: 'Group', color: '#EC4899', bg: '#FFF0F6' },
  deep_dive: { label: 'Deep', color: '#3B82F6', bg: '#EEF2FF' },
  capture_ask: { label: 'Capture', color: '#22C55E', bg: '#F0FDF4' },
  agent_initiated: { label: 'Agent', color: '#A855F7', bg: '#F5F3FF' },
}

function ActionIconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-[#9AA0A6] transition-colors hover:bg-[#E8EAED] hover:text-[#3C4043]"
    >
      <span className="block h-3.5 w-3.5">{children}</span>
    </button>
  )
}

/**
 * Unified floating chat panel — the bottom bar (input + modes + sources + files)
 * is always visible. The messages section smoothly expands/collapses above it.
 */
export function UnitChatPanel({ workspaceId }: UnitChatPanelProps) {
  // Sprint FE-5: lock state + session token come from the sharing store.
  // Replaces FE-4's read-only useIndexLockState hook so the pill can
  // open the passcode dialog and the store stays in sync after unlock/lock.
  const isLocked = useSharingStore((s) => s.isLocked)
  const hasPasscode = useSharingStore((s) => s.hasPasscode)
  const activePreset = useSharingStore((s) => s.activePreset)
  const setSessionToken = useSharingStore((s) => s.setSessionToken)
  const refreshLockState = useSharingStore((s) => s.refreshLockState)
  const lockIndex = useSharingStore((s) => s.lockIndex)
  const [passcodeDialogOpen, setPasscodeDialogOpen] = useState(false)

  const {
    unitState,
    activeMode,
    activeChatId,
    chatFileId,
    chatPanelHeight,
    showThreadHistory,
    attachedSources,
    isWebRecording,
    setActiveChatId,
    setChatPanelHeight,
    setShowThreadHistory,
    setActiveMode,
    expand,
    collapse,
    minimize,
    addSource,
    removeSource,
    toggleWebRecording,
  } = useFloatingUnitStore()

  const { createGhost } = useGhostDraftStore()

  // Ghost placement confirmations shown in chat
  const [ghostPlacements, setGhostPlacements] = useState<
    Array<{ id: string; anchorParagraph: number }>
  >([])

  const editor = useEditorRefStore((s) => s.editor)
  const { threads, setThreads, setActiveThread, activeThreadId } = useDocThreadsStore()
  const { setActiveGroupThread } = useGroupThreadStore()
  const router = useRouter()

  const [inputValue, setInputValue] = useState('')
  const [isGroupView, setIsGroupView] = useState(false)
  const [showFilesDropdown, setShowFilesDropdown] = useState(false)
  const [showNewChatMenu, setShowNewChatMenu] = useState(false)
  const [showGroupCreateModal, setShowGroupCreateModal] = useState(false)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [copiedToast, setCopiedToast] = useState(false)
  const newChatMenuRef = useRef<HTMLDivElement>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingMessageRef = useRef<string>('')
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)
  const filesDropdownRef = useRef<HTMLDivElement>(null)

  // Whether the messages section is visible
  const showMessages = unitState === 'expanded' && activeMode === 'none'
  const messagesHeight = showMessages ? Math.max(chatPanelHeight - BOTTOM_BAR_HEIGHT, 200) : 0

  // ─── Queries ───

  const { data: conversationsData, refetch: refetchConversations } = useQuery({
    queryKey: ['unit-conversations', workspaceId, chatFileId],
    queryFn: () =>
      api.get<ChatConversation[]>(
        `/api/chat/conversations?workspaceId=${workspaceId}${chatFileId ? `&contextObjectId=${chatFileId}` : ''}`
      ),
    enabled: !!workspaceId,
  })
  const conversations = conversationsData?.data ?? []

  const { data: filesData } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: () => api.get<WorkspaceFile[]>(`/api/files?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
  })
  const workspaceFiles = filesData?.data ?? []

  // Fetch the document name when chat is scoped to a file (Following bar)
  const contextDocName = useMemo(() => {
    if (!chatFileId) return null
    const f = workspaceFiles.find((wf) => wf.id === chatFileId)
    return f?.name ?? null
  }, [chatFileId, workspaceFiles])

  // ─── SSE Chat hook ───

  const {
    messages,
    streamingContent,
    toolStatus,
    isStreaming,
    sendMessage,
    stopStreaming,
    setMessages,
  } = useSSEChat({
    conversationId: activeChatId,
    workspaceId,
    onDone: () => {
      // Record AI interaction in local provenance
      useLocalProvenanceStore
        .getState()
        .recordAIInteraction(
          'AI responded to chat message',
          'User asked a question and received AI response'
        )
      refetchConversations()
    },
    onGhostDraftContent: (content, sourcePrompt) => {
      if (!editor) return
      // Get current cursor position to determine anchor paragraph
      const { from } = editor.state.selection
      const resolved = editor.state.doc.resolve(from)
      const anchorBlockId = `para-${resolved.index(0)}`
      const paragraphIndex = resolved.index(0)

      // Create ghost in store
      const ghostId = createGhost({
        content,
        anchorBlockId,
        sourcePrompt,
        threadId: activeChatId ?? '',
      })

      // Insert ghostDraft node into TipTap at cursor position
      const insertPos = resolved.after(1)
      editor
        .chain()
        .focus()
        .insertContentAt(insertPos, {
          type: 'ghostDraft',
          attrs: {
            id: ghostId,
            anchorBlockId,
            sourcePrompt,
            threadId: activeChatId ?? '',
            state: 'preview',
            createdAt: new Date().toISOString(),
          },
          content: [{ type: 'text', text: content }],
        })
        .run()

      // Show placement confirmation in chat
      setGhostPlacements((prev) => [...prev, { id: ghostId, anchorParagraph: paragraphIndex }])
    },
    onAnnotationContent: (annotations, _summary) => {
      // Store annotations and dispatch event for the editor to apply marks
      useAiAnnotationStore.getState().setAnnotations(annotations)
      window.dispatchEvent(
        new CustomEvent('ai-annotations-received', {
          detail: { annotations },
        })
      )
    },
  })

  // ─── Mutation ───

  const createConversationMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<ChatConversation>('/api/chat/conversations', {
        workspaceId,
        title: 'New Chat',
        type: 'standard',
        contextObjectId: chatFileId,
        contextObjectType: chatFileId ? 'file' : null,
      })
      if (res.error) throw new Error(res.error.message)
      return res.data!
    },
    onSuccess: (conv) => {
      setActiveChatId(conv.id)
      refetchConversations()
    },
  })

  // ─── Queries (messages) ───

  const { data: existingMessages } = useQuery({
    queryKey: ['unit-messages', activeChatId],
    queryFn: () => api.get<ChatMessageType[]>(`/api/chat/conversations/${activeChatId}/messages`),
    enabled: !!activeChatId,
  })

  // ─── Effects ───

  // Sync web recording state with Chrome extension
  useEffect(() => {
    const handleExtensionMessage = (event: MessageEvent) => {
      if (event.source !== window) return
      if (event.data?.type === 'workspace-live-state') {
        const extensionLive = !!event.data.liveEnabled
        if (extensionLive !== isWebRecording) {
          useFloatingUnitStore.getState().setWebRecording(extensionLive)
        }
      }
    }
    window.addEventListener('message', handleExtensionMessage)
    // Request current state from extension on mount
    window.postMessage({ type: 'workspace-get-live-state' }, '*')
    return () => window.removeEventListener('message', handleExtensionMessage)
  }, [])

  // Close files dropdown on outside click
  useEffect(() => {
    if (!showFilesDropdown) return
    const handleClick = (e: MouseEvent) => {
      if (filesDropdownRef.current && !filesDropdownRef.current.contains(e.target as Node)) {
        setShowFilesDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showFilesDropdown])

  // Sync conversations → thread store
  useEffect(() => {
    if (conversations.length > 0) {
      const mapped = conversations.map((conv) => conversationToThread(conv))
      setThreads(mapped)
    }
  }, [conversations, setThreads])

  // Auto-select conversation
  useEffect(() => {
    if (!activeChatId && conversations.length > 0) {
      setActiveChatId(conversations[0]!.id)
    }
  }, [activeChatId, conversations, setActiveChatId])

  // Load existing messages when conversation changes
  useEffect(() => {
    if (existingMessages?.data) {
      setMessages(existingMessages.data)
    }
  }, [existingMessages?.data, setMessages])

  // Send pending message when conversation becomes available
  useEffect(() => {
    if (activeChatId && pendingMessageRef.current) {
      const { activeTabIndex: tabIdx, tabs: currentTabs } = useEditorTabsStore.getState()
      const activeLabel = currentTabs[tabIdx]?.label ?? ''
      const editorRef = useEditorRefStore.getState().editor
      const editorText =
        getActiveTabContent(
          editorRef as Parameters<typeof getActiveTabContent>[0],
          tabIdx,
          currentTabs.length
        ) ?? undefined
      const recentEdits = serializeEdits(useLocalProvenanceStore.getState().getRecentEdits())
      sendMessage(
        pendingMessageRef.current,
        [],
        activeLabel ? { index: tabIdx, title: activeLabel } : undefined,
        editorText,
        recentEdits.length > 0 ? recentEdits : undefined
      )
      pendingMessageRef.current = ''
    }
  }, [activeChatId, sendMessage])

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
      dragStartHeightRef.current = chatPanelHeight

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return
        const delta = dragStartYRef.current - ev.clientY
        const maxH = window.innerHeight - CHAT_PANEL_MAX_HEIGHT_OFFSET
        setChatPanelHeight(
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
    [chatPanelHeight, setChatPanelHeight]
  )

  // ─── Handlers ───

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return
    // Expand messages if not showing
    if (!showMessages) {
      expand()
      setActiveMode('none')
    }
    if (!activeChatId) {
      pendingMessageRef.current = inputValue
      createConversationMutation.mutate()
    } else {
      const { activeTabIndex: tabIdx, tabs: currentTabs } = useEditorTabsStore.getState()
      const activeLabel = currentTabs[tabIdx]?.label ?? ''
      const editorRef = useEditorRefStore.getState().editor
      const editorText =
        getActiveTabContent(
          editorRef as Parameters<typeof getActiveTabContent>[0],
          tabIdx,
          currentTabs.length
        ) ?? undefined
      const recentEdits = serializeEdits(useLocalProvenanceStore.getState().getRecentEdits())
      sendMessage(
        inputValue,
        [],
        activeLabel ? { index: tabIdx, title: activeLabel } : undefined,
        editorText,
        recentEdits.length > 0 ? recentEdits : undefined
      )
    }
    setInputValue('')
  }, [
    inputValue,
    showMessages,
    activeChatId,
    sendMessage,
    createConversationMutation,
    expand,
    setActiveMode,
  ])

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
      setActiveMode('none')
    }
  }, [showMessages, inputValue, expand, setActiveMode])

  const handleModeClick = useCallback(
    (mode: UnitActiveMode) => {
      // Web is a recording toggle — doesn't open a panel
      if (mode === 'web') {
        toggleWebRecording()
        // Tell Chrome extension to start/stop signal capture
        const newState = !isWebRecording
        window.postMessage({ type: 'workspace-set-live-state', liveEnabled: newState }, '*')
        return
      }
      if (activeMode === mode) {
        setActiveMode('none')
        collapse()
      } else {
        setActiveMode(mode)
        expand()
      }
    },
    [activeMode, isWebRecording, setActiveMode, expand, collapse, toggleWebRecording]
  )

  const handleToggleFile = useCallback(
    (file: WorkspaceFile) => {
      setSelectedFileIds((prev) => {
        const next = new Set(prev)
        if (next.has(file.id)) {
          next.delete(file.id)
          removeSource(file.id)
        } else {
          next.add(file.id)
          addSource({ id: file.id, type: 'file', label: file.name })
        }
        return next
      })
    },
    [addSource, removeSource]
  )

  const handleScrollToGhost = useCallback(
    (ghostId: string) => {
      if (!editor) return
      // Find the ghost node in the document and scroll to it
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'ghostDraft' && node.attrs.id === ghostId) {
          const domNode = editor.view.domAtPos(pos + 1)
          const el = domNode.node instanceof HTMLElement ? domNode.node : domNode.node.parentElement
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return false
        }
        return true
      })
    },
    [editor]
  )

  const handleNewChat = useCallback(() => {
    createConversationMutation.mutate()
    setShowThreadHistory(false)
    setShowNewChatMenu(false)
  }, [createConversationMutation, setShowThreadHistory])

  const handleCopyMessage = useCallback((content: string) => {
    void navigator.clipboard.writeText(content)
    setCopiedToast(true)
    setTimeout(() => setCopiedToast(false), 1500)
  }, [])

  const handleSendFeedback = useCallback(
    async (messageId: string, feedback: 'positive' | 'negative') => {
      if (!activeChatId) return
      try {
        await api.post(`/api/chat/conversations/${activeChatId}/messages/${messageId}/feedback`, {
          feedback,
        })
      } catch (err) {
        console.warn('[UnitChatPanel] feedback failed', err)
      }
    },
    [activeChatId]
  )

  // Close new-chat menu on outside click
  useEffect(() => {
    if (!showNewChatMenu) return
    const handleClick = (e: MouseEvent) => {
      if (newChatMenuRef.current && !newChatMenuRef.current.contains(e.target as Node)) {
        setShowNewChatMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showNewChatMenu])

  const handleSelectConversation = useCallback(
    (convId: string) => {
      setActiveChatId(convId)
      setIsGroupView(false)
      setShowThreadHistory(false)
    },
    [setActiveChatId, setShowThreadHistory]
  )

  const handleSelectThread = useCallback(
    (threadId: string) => {
      const thread = threads.find((t) => t.id === threadId)
      if (thread?.type === 'group') {
        setIsGroupView(true)
        setActiveGroupThread(threadId)
        setActiveThread(threadId)
      } else {
        setIsGroupView(false)
        setActiveChatId(threadId)
        setActiveThread(threadId)
      }
      setShowThreadHistory(false)
    },
    [threads, setActiveChatId, setActiveThread, setActiveGroupThread, setShowThreadHistory]
  )

  const handleNewThread = useCallback(
    (type: DocThreadType) => {
      if (type === 'group') {
        const groupThread = {
          id: `group-${Date.now()}`,
          title: 'Group Discussion',
          type: 'group' as const,
          preview: '',
          messageCount: 0,
          isPinned: false,
          memberCount: 1,
          onlineCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        useDocThreadsStore.getState().addThread(groupThread)
        setIsGroupView(true)
        setActiveGroupThread(groupThread.id)
      } else {
        createConversationMutation.mutate()
      }
      setShowThreadHistory(false)
    },
    [createConversationMutation, setActiveGroupThread, setShowThreadHistory]
  )

  const activeConv = conversations.find((c) => c.id === activeChatId)
  const chatTitle = activeConv?.title || 'New Chat'

  // ─── Render ───

  // Smooth shadow that intensifies when expanded
  const cardShadow = showMessages
    ? '0 12px 48px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.05)'
    : '0 4px 20px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.03)'

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      {copiedToast && (
        <div
          className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs text-white"
          style={{ background: '#202124' }}
        >
          Copied!
        </div>
      )}
      {showGroupCreateModal && (
        <GroupCreateModal
          workspaceId={workspaceId}
          contextFileId={chatFileId}
          contextFileName={contextDocName}
          onClose={() => setShowGroupCreateModal(false)}
          onCreated={(conv) => {
            setShowGroupCreateModal(false)
            refetchConversations()
            // Switch into the new group thread
            useDocThreadsStore.getState().addThread({
              id: conv.id,
              title: conv.title,
              type: 'group',
              preview: '',
              messageCount: 0,
              isPinned: false,
              memberCount: conv.memberCount ?? 1,
              onlineCount: 1,
              createdAt: conv.createdAt,
              updatedAt: conv.updatedAt,
            })
            setIsGroupView(true)
            setActiveGroupThread(conv.id)
            setActiveThread(conv.id)
            setActiveChatId(conv.id)
          }}
        />
      )}
      <div
        className="overflow-hidden rounded-2xl bg-white"
        style={{
          width: 760,
          border: '1px solid #E0E0E0',
          boxShadow: cardShadow,
          transition: 'box-shadow 400ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* ════════════════════════════════════════════════════════════
            MESSAGES SECTION — smoothly expands / collapses above bar
           ════════════════════════════════════════════════════════════ */}
        <div
          style={{
            height: messagesHeight,
            transition: 'height 400ms cubic-bezier(0.22, 1, 0.36, 1)',
            overflow: 'hidden',
            willChange: showMessages ? 'height' : undefined,
          }}
        >
          <div
            className="flex flex-col"
            style={{
              height: Math.max(chatPanelHeight - BOTTOM_BAR_HEIGHT, 200),
              opacity: showMessages ? 1 : 0,
              transform: showMessages ? 'translateY(0)' : 'translateY(12px)',
              transition: 'opacity 350ms ease, transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* ── Drag handle ── */}
            <div
              onMouseDown={handleDragStart}
              className="group flex h-2 shrink-0 cursor-ns-resize items-center justify-center transition-colors hover:bg-[#F1F3F4]"
              title="Drag to resize"
            >
              <div className="h-[3px] w-10 rounded-full bg-[#DADCE0] transition-colors group-hover:bg-[#9AA0A6]" />
            </div>

            {/* ── Header ── */}
            <div
              className="flex shrink-0 items-center justify-between px-4 py-2"
              style={{ borderBottom: '1px solid #E8EAED' }}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowThreadHistory(!showThreadHistory)}
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#F1F3F4]"
                  title={showThreadHistory ? 'Close history' : 'Chat history'}
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#5F6368"
                    strokeWidth="2"
                  >
                    {showThreadHistory ? (
                      <path d="M15 19l-7-7 7-7" />
                    ) : (
                      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    )}
                  </svg>
                </button>
                <span className="text-sm font-medium" style={{ color: '#202124' }}>
                  {chatTitle}
                </span>
                {/* Sprint FE-5: clickable index lock indicator.
                    Click when locked → opens setup or unlock dialog (depending on hasPasscode).
                    Click when unlocked → calls /passcode/lock and flips to locked state. */}
                <button
                  type="button"
                  onClick={() => {
                    if (isLocked) {
                      setPasscodeDialogOpen(true)
                    } else {
                      void lockIndex()
                    }
                  }}
                  title={
                    hasPasscode
                      ? isLocked
                        ? 'Click to unlock your index'
                        : `Index unlocked · ${activePreset} preset · click to lock`
                      : 'Click to set up a passcode'
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    background: isLocked ? '#FEF2F2' : '#F0FDF4',
                    color: isLocked ? '#EF4444' : '#22C55E',
                    border: `1px solid ${isLocked ? '#FECACA' : '#BBF7D0'}`,
                    lineHeight: 1.2,
                    cursor: 'pointer',
                  }}
                >
                  <span aria-hidden>{isLocked ? '🔒' : '🔓'}</span>
                  <span>{isLocked ? 'Locked' : activePreset}</span>
                </button>
              </div>
              <div className="flex items-center gap-1">
                <div className="relative" ref={newChatMenuRef}>
                  <button
                    onClick={() => setShowNewChatMenu((v) => !v)}
                    className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-[#F1F3F4]"
                    style={{ color: '#1A73E8' }}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New
                  </button>
                  {showNewChatMenu && (
                    <div
                      className="absolute right-0 top-8 z-50 w-44 rounded-lg bg-white py-1 text-sm shadow-lg"
                      style={{ border: '1px solid #E8EAED' }}
                    >
                      <button
                        onClick={handleNewChat}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[#F1F3F4]"
                        style={{ color: '#3C4043' }}
                      >
                        <span>{'\uD83D\uDCAC'}</span>
                        <span>New Chat</span>
                      </button>
                      <button
                        onClick={() => {
                          setShowGroupCreateModal(true)
                          setShowNewChatMenu(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[#F1F3F4]"
                        style={{ color: '#3C4043' }}
                      >
                        <span>{'\uD83D\uDC65'}</span>
                        <span>New Group Chat</span>
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => collapse()}
                  title="Close chat"
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#F1F3F4]"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#5F6368"
                    strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ── Body: messages + drawer overlay ── */}
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {/* Sliding drawer backdrop */}
              <div
                className="absolute inset-0 z-10 bg-black/10 transition-opacity duration-200"
                style={{
                  opacity: showThreadHistory ? 1 : 0,
                  pointerEvents: showThreadHistory ? 'auto' : 'none',
                }}
                onClick={() => setShowThreadHistory(false)}
              />
              {/* Sliding drawer panel */}
              <div
                className="duration-250 absolute inset-y-0 left-0 z-20 flex w-[280px] flex-col bg-white shadow-xl transition-transform ease-out"
                style={{
                  transform: showThreadHistory ? 'translateX(0)' : 'translateX(-100%)',
                  borderRight: '1px solid #E8EAED',
                }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: '1px solid #E8EAED' }}
                >
                  <span className="text-sm font-semibold" style={{ color: '#202124' }}>
                    Chat History
                  </span>
                  <button
                    onClick={() => setShowThreadHistory(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#F1F3F4]"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#5F6368"
                      strokeWidth="2"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {conversations.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs" style={{ color: '#9AA0A6' }}>
                      No conversations yet.
                      <br />
                      Start chatting below!
                    </p>
                  ) : (
                    [...conversations]
                      .sort((a, b) => {
                        const aPin = !!(a.metadata as Record<string, unknown> | null)?.['isPinned']
                        const bPin = !!(b.metadata as Record<string, unknown> | null)?.['isPinned']
                        if (aPin && !bPin) return -1
                        if (!aPin && bPin) return 1
                        return 0
                      })
                      .map((conv) => {
                        const isActive = conv.id === activeChatId
                        const isPinned = !!(conv.metadata as Record<string, unknown> | null)?.[
                          'isPinned'
                        ]
                        const badge = TYPE_BADGES[conv.type] ?? TYPE_BADGES.standard!
                        return (
                          <div
                            key={conv.id}
                            className="group mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[#F1F3F4]"
                            style={{ background: isActive ? '#E8F0FE' : undefined }}
                          >
                            <button
                              onClick={() => handleSelectConversation(conv.id)}
                              className="flex flex-1 items-center gap-2.5 text-left"
                            >
                              <svg
                                className="h-4 w-4 shrink-0"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke={isActive ? '#1A73E8' : '#9AA0A6'}
                                strokeWidth="1.5"
                              >
                                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                              </svg>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  {isPinned && (
                                    <span className="text-[10px]" title="Pinned">
                                      {'\uD83D\uDCCC'}
                                    </span>
                                  )}
                                  <span
                                    className="truncate text-sm"
                                    style={{
                                      color: isActive ? '#1A73E8' : '#3C4043',
                                      fontWeight: isActive ? 600 : 400,
                                    }}
                                  >
                                    {conv.title || 'Untitled'}
                                  </span>
                                  <span
                                    className="ml-1 shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-medium"
                                    style={{ background: badge.bg, color: badge.color }}
                                  >
                                    {badge.label}
                                  </span>
                                </div>
                              </div>
                            </button>
                            <ConversationMenu
                              conversationId={conv.id}
                              currentTitle={conv.title || 'Untitled'}
                              isPinned={isPinned}
                              onUpdated={() => refetchConversations()}
                              onDeleted={() => {
                                if (activeChatId === conv.id) setActiveChatId(null)
                                refetchConversations()
                              }}
                            />
                          </div>
                        )
                      })
                  )}
                  {threads.filter((t) => t.type === 'group').length > 0 && (
                    <div className="mt-3 border-t pt-2" style={{ borderColor: '#E8EAED' }}>
                      <p
                        className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: '#9AA0A6' }}
                      >
                        Groups
                      </p>
                      {threads
                        .filter((t) => t.type === 'group')
                        .map((thread) => (
                          <button
                            key={thread.id}
                            onClick={() => handleSelectThread(thread.id)}
                            className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[#F1F3F4]"
                          >
                            <span className="text-sm">{'\uD83D\uDC65'}</span>
                            <span className="flex-1 truncate text-sm" style={{ color: '#3C4043' }}>
                              {thread.title}
                            </span>
                            {thread.onlineCount != null && (
                              <span className="text-[10px]" style={{ color: '#9AA0A6' }}>
                                {thread.onlineCount}/{thread.memberCount}
                              </span>
                            )}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <div className="shrink-0 border-t p-2" style={{ borderColor: '#E8EAED' }}>
                  <button
                    onClick={handleNewChat}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors hover:bg-[#F1F3F4]"
                    style={{ color: '#1A73E8' }}
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New Chat
                  </button>
                  <button
                    onClick={() => handleNewThread('group')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm transition-colors hover:bg-[#F1F3F4]"
                    style={{ color: '#5F6368' }}
                  >
                    <span>{'\uD83D\uDC65'}</span> New Group
                  </button>
                </div>
              </div>

              {/* Main messages area */}
              {isGroupView && activeThreadId ? (
                <GroupChatPanel
                  threadId={activeThreadId}
                  workspaceId={workspaceId}
                  currentUserId="current-user"
                  currentUserName="You"
                />
              ) : (
                <div className="flex min-w-0 flex-1 flex-col">
                  {/* Following bar — appears for document-scoped chats */}
                  {contextDocName && chatFileId && (
                    <div
                      className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs"
                      style={{ background: '#F8F9FA', borderBottom: '1px solid #E8EAED' }}
                    >
                      <span
                        className="font-medium uppercase tracking-wide"
                        style={{ color: '#9AA0A6' }}
                      >
                        Following
                      </span>
                      <span
                        className="cursor-pointer rounded px-2 py-0.5 text-xs font-medium"
                        style={{ background: '#EEF2FF', color: '#6366F1' }}
                        onClick={() =>
                          router.push(`/workspace/${workspaceId}/editor/${chatFileId}`)
                        }
                        title="Open document"
                      >
                        {'\uD83D\uDCC4'} {contextDocName}
                      </span>
                    </div>
                  )}
                  <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
                    {/* SCOPE-LIVECTX-1: live context block, renders only when scope.mode='live' */}
                    <LiveContextBlock className="mb-3" />
                    {messages.length === 0 && !isStreaming && (
                      <div className="flex h-full flex-col items-center justify-center">
                        <div
                          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                          style={{ background: '#6366F1' }}
                        >
                          F
                        </div>
                        <p className="text-sm font-medium" style={{ color: '#202124' }}>
                          How can I help?
                        </p>
                        <p className="mt-1 text-xs" style={{ color: '#9AA0A6' }}>
                          Ask anything about your document or workspace.
                        </p>
                      </div>
                    )}
                    <div className="space-y-4">
                      {messages.map((msg) => {
                        const sources = (msg.metadata as Record<string, unknown> | undefined)
                          ?.sources as Array<{ label: string; type: string }> | undefined
                        const isAssistant = msg.role === 'assistant'
                        return (
                          <div
                            key={msg.id}
                            className={`group flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            onMouseEnter={() => setHoveredMessageId(msg.id)}
                            onMouseLeave={() =>
                              setHoveredMessageId((prev) => (prev === msg.id ? null : prev))
                            }
                          >
                            {isAssistant && (
                              <div
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                                style={{ background: '#6366F1' }}
                              >
                                F
                              </div>
                            )}
                            <div className="flex max-w-[80%] flex-col">
                              <div
                                className="rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                                style={{
                                  background: msg.role === 'user' ? '#E8F0FE' : '#F1F3F4',
                                  color: '#202124',
                                }}
                              >
                                {msg.role === 'user' ? (
                                  msg.content
                                ) : (
                                  <ChatMarkdown content={msg.content} />
                                )}
                                {/* Rich content blocks */}
                                {isAssistant && msg.richContent && msg.richContent.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {msg.richContent.map((block, i) => (
                                      <RichContentBlock key={i} block={block} />
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Source pills */}
                              {isAssistant && sources && sources.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {sources.map((s, i) => (
                                    <span
                                      key={i}
                                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                                      style={{ background: '#EEF2FF', color: '#6366F1' }}
                                      title={s.type}
                                    >
                                      {s.label}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Sprint FE-4: Reference agent version citations.
                                  Populated post-stream via fetch of chat_messages.metadata.
                                  Renders only when the agent activated (simple queries bypass). */}
                              {isAssistant &&
                                (() => {
                                  const meta = msg.metadata as Record<string, unknown> | undefined
                                  const citations = meta?.versionCitations as
                                    | Array<{
                                        sourceFileId?: string | null
                                        sourceVersion?: number | null
                                        sourceContentHash?: string | null
                                        timestamp?: string
                                        label?: string
                                      }>
                                    | undefined
                                  const agentIntent = meta?.agentIntent as string | null | undefined
                                  if (!citations || citations.length === 0) return null
                                  return (
                                    <div
                                      className="mt-2 flex flex-wrap items-center gap-1 pt-2"
                                      style={{ borderTop: '1px solid #F0EEEA' }}
                                    >
                                      {agentIntent && (
                                        <span
                                          className="mr-1"
                                          style={{
                                            fontSize: 10,
                                            color: '#F97316',
                                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                                          }}
                                          title="Reference agent intent"
                                        >
                                          {agentIntent}
                                        </span>
                                      )}
                                      {citations.map((c, i) => (
                                        <VersionCitation
                                          key={i}
                                          sourceFileId={c.sourceFileId}
                                          sourceVersion={c.sourceVersion}
                                          sourceContentHash={c.sourceContentHash}
                                          timestamp={c.timestamp}
                                          label={c.label ?? 'source'}
                                          compact
                                        />
                                      ))}
                                    </div>
                                  )
                                })()}

                              {/* Hover actions */}
                              {isAssistant && (
                                <div
                                  className="mt-1 flex items-center gap-1 transition-opacity"
                                  style={{
                                    opacity: hoveredMessageId === msg.id ? 1 : 0,
                                  }}
                                >
                                  <ActionIconButton
                                    title="Copy"
                                    onClick={() => handleCopyMessage(msg.content)}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    >
                                      <rect x="9" y="9" width="13" height="13" rx="2" />
                                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                    </svg>
                                  </ActionIconButton>
                                  <ActionIconButton
                                    title="Helpful"
                                    onClick={() => handleSendFeedback(msg.id, 'positive')}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    >
                                      <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9A2 2 0 0019.72 9zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
                                    </svg>
                                  </ActionIconButton>
                                  <ActionIconButton
                                    title="Not helpful"
                                    onClick={() => handleSendFeedback(msg.id, 'negative')}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    >
                                      <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9A2 2 0 004.28 15zM17 2h3a2 2 0 012 2v7a2 2 0 01-2 2h-3" />
                                    </svg>
                                  </ActionIconButton>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {isStreaming && (
                        <div className="flex gap-3">
                          <div
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                            style={{ background: '#6366F1' }}
                          >
                            F
                          </div>
                          <div
                            className="rounded-2xl px-4 py-2.5 text-sm"
                            style={{ background: '#F1F3F4', color: '#3C4043' }}
                          >
                            {toolStatus && (
                              <div
                                className="mb-1.5 flex items-center gap-2 text-xs"
                                style={{ color: '#6366F1' }}
                              >
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                {toolStatus}
                              </div>
                            )}
                            {streamingContent && <ChatMarkdown content={streamingContent} />}
                            <span
                              className="ml-0.5 inline-block h-4 w-0.5 animate-pulse"
                              style={{ background: '#6366F1' }}
                            />
                          </div>
                        </div>
                      )}
                      {/* Ghost placement confirmations */}
                      {ghostPlacements.map((gp) => (
                        <div
                          key={gp.id}
                          className="flex items-center gap-2 rounded-lg px-3 py-2"
                          style={{
                            border: '1px dashed var(--ai, #6366F1)',
                            background: 'var(--aiS, #EEF2FF)',
                          }}
                          data-testid={`ghost-placement-${gp.id}`}
                        >
                          <span className="text-xs" style={{ color: 'var(--ai, #6366F1)' }}>
                            Preview placed after &#182;{gp.anchorParagraph}
                          </span>
                          <button
                            onClick={() => handleScrollToGhost(gp.id)}
                            className="text-xs font-medium underline"
                            style={{ color: 'var(--ai, #6366F1)' }}
                          >
                            scroll to view
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
            BOTTOM BAR — always visible, identical in all states
           ════════════════════════════════════════════════════════════ */}
        <div
          style={{
            borderTop: '1px solid',
            borderColor: showMessages ? '#E8EAED' : 'transparent',
            transition: 'border-color 300ms ease',
          }}
        >
          {/* Input row */}
          <div className="flex items-center gap-2 px-4 py-2.5">
            {/* F icon */}
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: '#6366F1' }}
            >
              F
            </div>

            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={handleInputClick}
              placeholder="Ask anything..."
              rows={1}
              className="floating-unit-input flex-1 resize-none bg-transparent text-sm leading-relaxed text-[#202124] placeholder:text-[#9AA0A6] focus:outline-none"
              style={{ maxHeight: 80, minHeight: 22 }}
              disabled={isStreaming}
            />

            {/* Send / Stop */}
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#F1F3F4]"
                title="Stop"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#5F6368">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:opacity-40"
                style={{ background: '#1A73E8' }}
                title="Send (Enter)"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            )}

            {/* Minimize */}
            <button
              onClick={() => minimize()}
              title="Minimize"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#F1F3F4]"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#5F6368"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>

          {/* Mode buttons | sources | files row */}
          <div className="flex items-center gap-1 px-4 pb-2.5">
            {/* Mode buttons */}
            <div className="flex items-center gap-0.5">
              {MODE_BUTTONS.map(({ mode, icon, label }) => {
                // Web is a recording toggle with a green indicator
                const isWebActive = mode === 'web' && isWebRecording
                const isPanelActive = mode !== 'web' && activeMode === mode

                return (
                  <button
                    key={mode}
                    onClick={() => handleModeClick(mode)}
                    aria-label={label}
                    aria-pressed={isWebActive || isPanelActive}
                    title={
                      mode === 'web'
                        ? isWebRecording
                          ? 'Stop web recording'
                          : 'Start web recording — captures browsing across all tabs'
                        : label
                    }
                    className="relative rounded-lg px-2 py-1 text-xs transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
                    style={{
                      background: isWebActive ? '#DCFCE7' : isPanelActive ? '#E8F0FE' : undefined,
                      color: isWebActive ? '#16A34A' : isPanelActive ? '#1A73E8' : '#5F6368',
                    }}
                  >
                    {/* Green pulsing dot when web recording */}
                    {isWebActive && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                      </span>
                    )}
                    {icon} {label}
                  </button>
                )
              })}
            </div>

            <div className="mx-1.5 h-4 w-px" style={{ background: '#E8EAED' }} />

            {/* Attached sources */}
            <div className="flex items-center gap-1">
              {attachedSources.map((source) => (
                <span
                  key={source.id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                  style={{ background: '#F1F3F4', color: '#3C4043' }}
                >
                  {source.type === 'file' ? '\uD83D\uDCC1' : '\uD83D\uDCCE'} {source.label}
                  <button
                    onClick={() => removeSource(source.id)}
                    className="ml-0.5 text-[#9AA0A6] hover:text-[#5F6368]"
                  >
                    {'\u00D7'}
                  </button>
                </span>
              ))}
              <button
                className="rounded-full px-2 py-0.5 text-[11px] transition-colors hover:bg-[#F1F3F4]"
                style={{ color: '#9AA0A6' }}
              >
                + Add source
              </button>
            </div>

            <div className="mx-1.5 h-4 w-px" style={{ background: '#E8EAED' }} />

            {/* Add files dropdown */}
            <div className="relative" ref={filesDropdownRef}>
              <button
                onClick={() => setShowFilesDropdown(!showFilesDropdown)}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors hover:bg-[#F1F3F4]"
                style={{ color: selectedFileIds.size > 0 ? '#1A73E8' : '#9AA0A6' }}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {selectedFileIds.size > 0
                  ? `${selectedFileIds.size} file${selectedFileIds.size > 1 ? 's' : ''}`
                  : '+ Add files'}
              </button>

              {showFilesDropdown && (
                <div
                  className="absolute bottom-full left-0 z-50 mb-1 w-[280px] overflow-hidden rounded-xl bg-white"
                  style={{
                    border: '1px solid #DADCE0',
                    boxShadow: '0 -4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.03)',
                    maxHeight: 260,
                  }}
                >
                  <div
                    className="flex items-center justify-between px-3 py-2"
                    style={{ borderBottom: '1px solid #E8EAED' }}
                  >
                    <span className="text-xs font-semibold" style={{ color: '#202124' }}>
                      Workspace Files
                    </span>
                    {selectedFileIds.size > 0 && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ background: '#E8F0FE', color: '#1A73E8' }}
                      >
                        {selectedFileIds.size} selected
                      </span>
                    )}
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                    {workspaceFiles.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs" style={{ color: '#9AA0A6' }}>
                        No files in workspace
                      </p>
                    ) : (
                      workspaceFiles.map((file) => {
                        const isSelected = selectedFileIds.has(file.id)
                        return (
                          <button
                            key={file.id}
                            onClick={() => handleToggleFile(file)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#F8F9FA]"
                            style={{ background: isSelected ? '#F0F4FF' : undefined }}
                          >
                            <div
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                              style={{
                                borderColor: isSelected ? '#1A73E8' : '#DADCE0',
                                background: isSelected ? '#1A73E8' : '#FFFFFF',
                              }}
                            >
                              {isSelected && (
                                <svg
                                  className="h-3 w-3"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="white"
                                  strokeWidth="3"
                                >
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              )}
                            </div>
                            <span className="text-sm">
                              {file.mimeType?.includes('spreadsheet') ||
                              file.mimeType?.includes('excel')
                                ? '\uD83D\uDCCA'
                                : file.mimeType?.includes('presentation') ||
                                    file.mimeType?.includes('powerpoint')
                                  ? '\uD83D\uDCFD'
                                  : file.mimeType?.includes('image')
                                    ? '\uD83D\uDDBC'
                                    : file.mimeType?.includes('pdf')
                                      ? '\uD83D\uDCC4'
                                      : '\uD83D\uDCC3'}
                            </span>
                            <span
                              className="flex-1 truncate text-xs"
                              style={{ color: isSelected ? '#1A73E8' : '#3C4043' }}
                            >
                              {file.name}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Sprint FE-5: passcode dialog (mounted once at root, controlled by lock pill) */}
      <PasscodeDialog
        isOpen={passcodeDialogOpen}
        onClose={() => setPasscodeDialogOpen(false)}
        mode={hasPasscode ? 'unlock' : 'setup'}
        onUnlocked={(token) => {
          setSessionToken(token)
          void refreshLockState()
        }}
      />
    </div>
  )
}
