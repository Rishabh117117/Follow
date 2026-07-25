import { create } from 'zustand'

/**
 * Thread types for document conversations:
 * - chat: General Q&A with AI about the document
 * - edit: AI-assisted editing thread (rewrites, suggestions)
 * - group: Multi-user discussion thread (future: WebSocket)
 */
export type DocThreadType = 'chat' | 'edit' | 'group'

export interface DocThread {
  id: string
  title: string
  type: DocThreadType
  preview: string
  messageCount: number
  isPinned: boolean
  createdAt: string
  updatedAt: string
  /** Number of members (group threads only) */
  memberCount?: number
  /** Number of online members (group threads only) */
  onlineCount?: number
}

interface DocThreadsState {
  /** All threads for the current document */
  threads: DocThread[]
  /** Currently active thread ID */
  activeThreadId: string | null
  /** Filter by thread type (null = show all) */
  typeFilter: DocThreadType | null

  // Actions
  setThreads: (threads: DocThread[]) => void
  setActiveThread: (id: string | null) => void
  setTypeFilter: (type: DocThreadType | null) => void
  addThread: (thread: DocThread) => void
  removeThread: (id: string) => void
  updateThread: (id: string, update: Partial<DocThread>) => void
  togglePin: (id: string) => void
  reset: () => void
}

export const useDocThreadsStore = create<DocThreadsState>((set, _get) => ({
  threads: [],
  activeThreadId: null,
  typeFilter: null,

  setThreads: (threads) => set({ threads }),

  setActiveThread: (id) => set({ activeThreadId: id }),

  setTypeFilter: (type) => set({ typeFilter: type }),

  addThread: (thread) =>
    set((s) => ({
      threads: [thread, ...s.threads],
      activeThreadId: thread.id,
    })),

  removeThread: (id) =>
    set((s) => ({
      threads: s.threads.filter((t) => t.id !== id),
      activeThreadId: s.activeThreadId === id ? null : s.activeThreadId,
    })),

  updateThread: (id, update) =>
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, ...update } : t)),
    })),

  togglePin: (id) =>
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, isPinned: !t.isPinned } : t)),
    })),

  reset: () => set({ threads: [], activeThreadId: null, typeFilter: null }),
}))

/** Get filtered and sorted threads (pinned first, then by updatedAt) */
export function getFilteredThreads(
  threads: DocThread[],
  typeFilter: DocThreadType | null
): DocThread[] {
  const filtered = typeFilter ? threads.filter((t) => t.type === typeFilter) : threads
  // Pinned first, then by updatedAt descending
  return [...filtered].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

/** Helper: create a new thread object from a conversation response */
export function conversationToThread(
  conv: {
    id: string
    title: string
    type?: string
    updatedAt: string | Date
    createdAt: string | Date
  },
  options?: { threadType?: DocThreadType; preview?: string; messageCount?: number }
): DocThread {
  return {
    id: conv.id,
    title: conv.title || 'Untitled',
    type: options?.threadType ?? mapConversationType(conv.type),
    preview: options?.preview ?? '',
    messageCount: options?.messageCount ?? 0,
    isPinned: false,
    createdAt: typeof conv.createdAt === 'string' ? conv.createdAt : conv.createdAt.toISOString(),
    updatedAt: typeof conv.updatedAt === 'string' ? conv.updatedAt : conv.updatedAt.toISOString(),
  }
}

/** Map backend conversation type to DocThreadType */
function mapConversationType(type?: string): DocThreadType {
  switch (type) {
    case 'deep_dive':
      return 'edit'
    case 'capture_ask':
      return 'edit'
    default:
      return 'chat'
  }
}
