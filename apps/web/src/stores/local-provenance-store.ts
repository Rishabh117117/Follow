import { create } from 'zustand'
import { computeWordDiff } from './provenance-store'
import type { DiffSegment } from './provenance-store'

/**
 * Local Provenance Store — client-side fallback for provenance tracking
 * when the backend API (ClickHouse + distillation pipeline) is unavailable.
 *
 * Captures editor events locally and generates synthetic ThreadEvent-compatible
 * objects that the provenance panel can display.
 *
 * Also provides word-level document edit tracking (DocumentEdit) for AI chat context.
 */

// ─── Document Edit Tracking (word-level diffs for AI chat) ─────────

export interface DocumentEdit {
  id: string
  time: string // ISO timestamp
  editType: 'insertion' | 'deletion' | 'replacement'
  removedText: string // exact text removed (empty for insertions)
  addedText: string // exact text added (empty for deletions)
  context: string // ~40 chars of surrounding unchanged text for location
}

const MAX_RECENT_EDITS = 20
const DEFAULT_EDIT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Extract structured edits from a word-level diff.
 * Groups contiguous added/removed segments into insertion/deletion/replacement edits.
 */
export function extractEditsFromDiff(beforeText: string, afterText: string): DocumentEdit[] {
  if (beforeText === afterText) return []

  const segments = computeWordDiff(beforeText, afterText)
  const edits: DocumentEdit[] = []
  let i = 0

  while (i < segments.length) {
    const seg = segments[i]!

    if (seg.type === 'unchanged') {
      i++
      continue
    }

    // Collect contiguous removed text
    let removedText = ''
    while (i < segments.length && segments[i]!.type === 'removed') {
      removedText += segments[i]!.text
      i++
    }

    // Collect contiguous added text immediately after removed
    let addedText = ''
    while (i < segments.length && segments[i]!.type === 'added') {
      addedText += segments[i]!.text
      i++
    }

    // Skip trivial changes (whitespace-only or < 2 non-whitespace chars)
    const removedTrimmed = removedText.replace(/\s/g, '')
    const addedTrimmed = addedText.replace(/\s/g, '')
    if (removedTrimmed.length < 2 && addedTrimmed.length < 2) continue

    // Determine edit type
    let editType: DocumentEdit['editType']
    if (removedText && addedText) {
      editType = 'replacement'
    } else if (removedText) {
      editType = 'deletion'
    } else {
      editType = 'insertion'
    }

    // Capture context from nearest unchanged segments
    const context = getEditContext(segments, i, removedText, addedText)

    edits.push({
      id: generateId(),
      time: new Date().toISOString(),
      editType,
      removedText: removedText.trim(),
      addedText: addedText.trim(),
      context,
    })
  }

  return edits
}

/** Get ~40 chars of surrounding unchanged text for location context */
function getEditContext(
  segments: DiffSegment[],
  currentIndex: number,
  _removed: string,
  _added: string
): string {
  // Look backward for unchanged text
  let before = ''
  for (let j = currentIndex - 1; j >= 0; j--) {
    if (segments[j]!.type === 'unchanged') {
      before = segments[j]!.text
      break
    }
  }

  // Look forward for unchanged text
  let after = ''
  for (let j = currentIndex; j < segments.length; j++) {
    if (segments[j]!.type === 'unchanged') {
      after = segments[j]!.text
      break
    }
  }

  // Take last ~20 chars of before and first ~20 chars of after
  const beforeSnippet = before.length > 20 ? '...' + before.slice(-20) : before
  const afterSnippet = after.length > 20 ? after.slice(0, 20) + '...' : after

  return (beforeSnippet + afterSnippet).trim()
}

// ─── Original Local Provenance Types ───────────────────────────────

export type LocalEventType =
  | 'edit'
  | 'ai_interaction'
  | 'structural_change'
  | 'session_start'
  | 'session_end'
  | 'gap'

export type LocalMagnitude = 'low' | 'medium' | 'high'

export interface LocalThreadEvent {
  id: string
  threadId: string
  sessionId?: string
  time: string
  label: string
  type: LocalEventType
  magnitude: LocalMagnitude
  distilledFrom: string[]
  contextNotes?: string
  keyChange: boolean
  migratedFromTimeline?: boolean
  metadata: Record<string, unknown>
  createdAt: string
}

/** Snapshot of document state for diff tracking */
interface DocumentSnapshot {
  text: string
  wordCount: number
  timestamp: string
  paragraphCount: number
}

/** Accumulated edit buffer for batching small edits into one event */
interface EditBuffer {
  startText: string
  startWordCount: number
  startTime: string
  changeCount: number
  lastChangeTime: string
  addedWords: number
  removedWords: number
}

interface LocalProvenanceState {
  /** Synthetic events generated from local activity */
  events: LocalThreadEvent[]
  /** Whether we're in local-only mode (API unavailable) */
  isLocalMode: boolean
  /** Current file being tracked */
  trackedFileId: string | null
  /** Session start time */
  sessionStartedAt: string | null
  /** Last document snapshot for diff comparison */
  lastSnapshot: DocumentSnapshot | null
  /** Buffered edits waiting to be flushed as an event */
  editBuffer: EditBuffer | null
  /** Total edits this session */
  totalEdits: number
  /** Total AI interactions this session */
  totalAI: number
  /** Total key events this session */
  totalKey: number
  /** Recent word-level edits for AI chat context (ring buffer, max 20) */
  recentEdits: DocumentEdit[]

  // Actions
  setLocalMode: (on: boolean) => void
  startSession: (fileId: string, initialText: string) => void
  endSession: () => void
  recordEdit: (currentText: string, contextNotes?: string) => void
  recordAIInteraction: (label: string, contextNotes?: string, isKey?: boolean) => void
  recordStructuralChange: (label: string, contextNotes?: string) => void
  flushEditBuffer: (currentText?: string) => void
  /** Get recent edits within a time window (default 5 minutes) */
  getRecentEdits: (withinMs?: number) => DocumentEdit[]
  clearEvents: () => void
  reset: () => void
}

let idCounter = 0
function generateId(): string {
  return `local-${Date.now()}-${++idCounter}`
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function countParagraphs(text: string): number {
  return text.split('\n').filter((line) => line.trim().length > 0).length
}

/** Determine edit magnitude based on word changes */
function getEditMagnitude(addedWords: number, removedWords: number): LocalMagnitude {
  const totalChange = addedWords + removedWords
  if (totalChange <= 5) return 'low'
  if (totalChange <= 50) return 'medium'
  return 'high'
}

/** Generate a human-readable edit label */
function getEditLabel(addedWords: number, removedWords: number): string {
  if (addedWords > 0 && removedWords > 0) {
    return `Edited text (+${addedWords} / -${removedWords} words)`
  }
  if (addedWords > 0) {
    return `Added ${addedWords} word${addedWords !== 1 ? 's' : ''}`
  }
  if (removedWords > 0) {
    return `Removed ${removedWords} word${removedWords !== 1 ? 's' : ''}`
  }
  return 'Minor text edit'
}

/** Flush interval — batch edits within this window into one event */
const EDIT_FLUSH_INTERVAL_MS = 10_000 // 10 seconds

export const useLocalProvenanceStore = create<LocalProvenanceState>((set, get) => ({
  events: [],
  isLocalMode: false,
  trackedFileId: null,
  sessionStartedAt: null,
  lastSnapshot: null,
  editBuffer: null,
  totalEdits: 0,
  totalAI: 0,
  totalKey: 0,
  recentEdits: [],

  setLocalMode: (on) => set({ isLocalMode: on }),

  startSession: (fileId, initialText) => {
    const now = new Date().toISOString()
    const sessionEvent: LocalThreadEvent = {
      id: generateId(),
      threadId: `local-doc-${fileId}`,
      time: now,
      label: 'Started editing session',
      type: 'session_start',
      magnitude: 'low',
      distilledFrom: ['session_open'],
      contextNotes: 'Document opened in editor',
      keyChange: false,
      metadata: { fileId },
      createdAt: now,
    }

    set({
      trackedFileId: fileId,
      sessionStartedAt: now,
      lastSnapshot: {
        text: initialText,
        wordCount: countWords(initialText),
        timestamp: now,
        paragraphCount: countParagraphs(initialText),
      },
      editBuffer: null,
      events: [sessionEvent],
      totalEdits: 0,
      totalAI: 0,
      totalKey: 0,
      recentEdits: [],
    })
  },

  endSession: () => {
    // Flush any pending edits first
    get().flushEditBuffer()

    const now = new Date().toISOString()
    const state = get()
    const sessionEvent: LocalThreadEvent = {
      id: generateId(),
      threadId: `local-doc-${state.trackedFileId}`,
      time: now,
      label: `Ended session (${state.totalEdits} edits, ${state.totalAI} AI interactions)`,
      type: 'session_end',
      magnitude: 'low',
      distilledFrom: ['session_close'],
      contextNotes: `Session lasted ${getSessionDuration(state.sessionStartedAt)}`,
      keyChange: false,
      metadata: {
        totalEdits: state.totalEdits,
        totalAI: state.totalAI,
        totalKey: state.totalKey,
      },
      createdAt: now,
    }

    set((s) => ({
      events: [...s.events, sessionEvent],
      trackedFileId: null,
      sessionStartedAt: null,
      editBuffer: null,
    }))
  },

  recordEdit: (currentText, _contextNotes) => {
    const state = get()
    if (!state.trackedFileId || !state.lastSnapshot) return

    const now = new Date().toISOString()
    const currentWordCount = countWords(currentText)
    const prevWordCount = state.lastSnapshot.wordCount

    // Start or append to edit buffer
    if (!state.editBuffer) {
      set({
        editBuffer: {
          startText: state.lastSnapshot.text,
          startWordCount: prevWordCount,
          startTime: now,
          changeCount: 1,
          lastChangeTime: now,
          addedWords: Math.max(0, currentWordCount - prevWordCount),
          removedWords: Math.max(0, prevWordCount - currentWordCount),
        },
        lastSnapshot: {
          text: currentText,
          wordCount: currentWordCount,
          timestamp: now,
          paragraphCount: countParagraphs(currentText),
        },
      })
    } else {
      // Accumulate changes
      const prevBufferWordCount = state.editBuffer.startWordCount
      set({
        editBuffer: {
          ...state.editBuffer,
          changeCount: state.editBuffer.changeCount + 1,
          lastChangeTime: now,
          addedWords: Math.max(0, currentWordCount - prevBufferWordCount),
          removedWords: Math.max(0, prevBufferWordCount - currentWordCount),
        },
        lastSnapshot: {
          text: currentText,
          wordCount: currentWordCount,
          timestamp: now,
          paragraphCount: countParagraphs(currentText),
        },
      })

      // Auto-flush if buffer is old enough
      const bufferAge = Date.now() - new Date(state.editBuffer.startTime).getTime()
      if (bufferAge >= EDIT_FLUSH_INTERVAL_MS) {
        // Defer flush to avoid nested set calls
        setTimeout(() => get().flushEditBuffer(currentText), 0)
      }
    }
  },

  flushEditBuffer: (currentText) => {
    const state = get()
    if (!state.editBuffer || !state.trackedFileId) return

    const { addedWords, removedWords, changeCount, startTime, lastChangeTime } = state.editBuffer
    if (addedWords === 0 && removedWords === 0) {
      set({ editBuffer: null })
      return
    }

    const magnitude = getEditMagnitude(addedWords, removedWords)
    const isKey = magnitude === 'high'
    const now = lastChangeTime

    const event: LocalThreadEvent = {
      id: generateId(),
      threadId: `local-doc-${state.trackedFileId}`,
      time: now,
      label: getEditLabel(addedWords, removedWords),
      type: 'edit',
      magnitude,
      distilledFrom: Array.from({ length: changeCount }, (_, i) => `keystroke_${i}`),
      contextNotes: `${changeCount} edit${changeCount !== 1 ? 's' : ''} over ${getTimeDelta(startTime, now)}`,
      keyChange: isKey,
      metadata: {
        addedWords,
        removedWords,
        changeCount,
        beforeText: state.editBuffer.startText.slice(-200),
        afterText: (currentText ?? state.lastSnapshot?.text ?? '').slice(-200),
      },
      createdAt: now,
    }

    // Extract word-level edits for AI chat context
    const beforeFull = state.editBuffer.startText
    const afterFull = currentText ?? state.lastSnapshot?.text ?? ''
    const detectedEdits = extractEditsFromDiff(beforeFull, afterFull)

    set((s) => {
      // Ring buffer: append new edits, cap at MAX_RECENT_EDITS
      const updatedEdits = [...s.recentEdits, ...detectedEdits].slice(-MAX_RECENT_EDITS)

      return {
        events: [...s.events, event],
        editBuffer: null,
        totalEdits: s.totalEdits + 1,
        totalKey: isKey ? s.totalKey + 1 : s.totalKey,
        recentEdits: updatedEdits,
      }
    })
  },

  getRecentEdits: (withinMs = DEFAULT_EDIT_WINDOW_MS) => {
    const state = get()
    const cutoff = Date.now() - withinMs
    return state.recentEdits.filter((e) => new Date(e.time).getTime() >= cutoff)
  },

  recordAIInteraction: (label, contextNotes, isKey = false) => {
    const state = get()
    if (!state.trackedFileId) return

    // Flush pending edits before recording AI event
    get().flushEditBuffer()

    const now = new Date().toISOString()
    const event: LocalThreadEvent = {
      id: generateId(),
      threadId: `local-doc-${state.trackedFileId}`,
      time: now,
      label,
      type: 'ai_interaction',
      magnitude: isKey ? 'high' : 'medium',
      distilledFrom: ['ai_chat_turn'],
      contextNotes,
      keyChange: isKey,
      metadata: {},
      createdAt: now,
    }

    set((s) => ({
      events: [...s.events, event],
      totalAI: s.totalAI + 1,
      totalKey: isKey ? s.totalKey + 1 : s.totalKey,
    }))
  },

  recordStructuralChange: (label, contextNotes) => {
    const state = get()
    if (!state.trackedFileId) return

    get().flushEditBuffer()

    const now = new Date().toISOString()
    const event: LocalThreadEvent = {
      id: generateId(),
      threadId: `local-doc-${state.trackedFileId}`,
      time: now,
      label,
      type: 'structural_change',
      magnitude: 'medium',
      distilledFrom: ['doc_structural_change'],
      contextNotes,
      keyChange: true,
      metadata: {},
      createdAt: now,
    }

    set((s) => ({
      events: [...s.events, event],
      totalEdits: s.totalEdits + 1,
      totalKey: s.totalKey + 1,
    }))
  },

  clearEvents: () => set({ events: [], totalEdits: 0, totalAI: 0, totalKey: 0, recentEdits: [] }),

  reset: () =>
    set({
      events: [],
      isLocalMode: false,
      trackedFileId: null,
      sessionStartedAt: null,
      lastSnapshot: null,
      editBuffer: null,
      totalEdits: 0,
      totalAI: 0,
      totalKey: 0,
      recentEdits: [],
    }),
}))

// ─── Helpers ───────────────────────────────────────────────────────

function getSessionDuration(startedAt: string | null): string {
  if (!startedAt) return 'unknown duration'
  const diffMs = Date.now() - new Date(startedAt).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'less than a minute'
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`
  const hours = Math.round(mins / 60)
  return `${hours} hour${hours !== 1 ? 's' : ''}`
}

function getTimeDelta(start: string, end: string): string {
  const diffMs = new Date(end).getTime() - new Date(start).getTime()
  const secs = Math.round(diffMs / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.round(secs / 60)
  return `${mins}m`
}
