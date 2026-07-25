import { create } from 'zustand'

/**
 * Group thread state — manages multiplayer chat messages, members,
 * @Follow AI mention detection, and WebSocket readiness.
 */

export interface GroupMember {
  id: string
  name: string
  /** Two-letter avatar string or emoji */
  avatar: string
  /** CSS color for presence indicator */
  color: string
  isOnline: boolean
}

export interface GroupMessage {
  id: string
  threadId: string
  senderId: string
  senderName: string
  content: string
  /** Whether this message was from the AI (@Follow mention response) */
  isAI: boolean
  /** Original mention text that triggered the AI (null if not AI response) */
  mentionTrigger: string | null
  createdAt: string
}

export interface GroupThreadState {
  /** Messages for the active group thread */
  messages: GroupMessage[]
  /** Members of the active group thread */
  members: GroupMember[]
  /** Active group thread ID */
  activeGroupThreadId: string | null
  /** Whether WebSocket is connected for real-time messaging */
  isConnected: boolean
  /** Whether AI is currently generating a response */
  aiResponding: boolean

  // Actions
  setActiveGroupThread: (id: string | null) => void
  addMessage: (msg: GroupMessage) => void
  setMessages: (msgs: GroupMessage[]) => void
  setMembers: (members: GroupMember[]) => void
  addMember: (member: GroupMember) => void
  removeMember: (id: string) => void
  updateMemberOnline: (id: string, isOnline: boolean) => void
  setConnected: (connected: boolean) => void
  setAIResponding: (responding: boolean) => void
  clearMessages: () => void
  reset: () => void
}

export const useGroupThreadStore = create<GroupThreadState>((set) => ({
  messages: [],
  members: [],
  activeGroupThreadId: null,
  isConnected: false,
  aiResponding: false,

  setActiveGroupThread: (id) =>
    set({ activeGroupThreadId: id, messages: [], members: [] }),

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  setMessages: (msgs) => set({ messages: msgs }),

  setMembers: (members) => set({ members }),

  addMember: (member) =>
    set((s) => {
      if (s.members.some((m) => m.id === member.id)) return s
      return { members: [...s.members, member] }
    }),

  removeMember: (id) =>
    set((s) => ({ members: s.members.filter((m) => m.id !== id) })),

  updateMemberOnline: (id, isOnline) =>
    set((s) => ({
      members: s.members.map((m) => (m.id === id ? { ...m, isOnline } : m)),
    })),

  setConnected: (connected) => set({ isConnected: connected }),

  setAIResponding: (responding) => set({ aiResponding: responding }),

  clearMessages: () => set({ messages: [] }),

  reset: () =>
    set({
      messages: [],
      members: [],
      activeGroupThreadId: null,
      isConnected: false,
      aiResponding: false,
    }),
}))

// ─── Mention parsing utilities ───────────────────────────────────────────

/** The AI mention handle */
export const AI_MENTION = '@Follow'

/**
 * Check if a message text contains an @Follow mention.
 */
export function hasMention(text: string): boolean {
  return /@Follow\b/i.test(text)
}

/**
 * Extract @Follow mention positions from message text.
 * Returns array of { start, end } positions.
 */
export function extractMentions(text: string): Array<{ start: number; end: number }> {
  const mentions: Array<{ start: number; end: number }> = []
  const regex = /@Follow\b/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    mentions.push({ start: match.index, end: match.index + match[0].length })
  }
  return mentions
}

/**
 * Strip @Follow mentions and return clean text for the AI prompt.
 */
export function stripMentions(text: string): string {
  return text.replace(/@Follow\b/gi, '').trim()
}

/**
 * Generate a unique member color from their ID (deterministic).
 */
export function getMemberColor(id: string): string {
  const COLORS = [
    '#7C3AED', // violet
    '#2563EB', // blue
    '#059669', // emerald
    '#D97706', // amber
    '#DC2626', // red
    '#DB2777', // pink
    '#0891B2', // cyan
    '#4F46E5', // indigo
  ]
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  return COLORS[Math.abs(hash) % COLORS.length]!
}

/**
 * Generate a two-letter avatar from a name.
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  return (name.slice(0, 2) || '??').toUpperCase()
}
