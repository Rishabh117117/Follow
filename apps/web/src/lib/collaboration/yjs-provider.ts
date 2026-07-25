'use client'

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const YJS_WS_URL = process.env.NEXT_PUBLIC_YJS_WS_URL ?? 'ws://localhost:3003'

interface ProviderEntry {
  doc: Y.Doc
  provider: WebsocketProvider
  refCount: number
}

const providers = new Map<string, ProviderEntry>()

export interface CollaborationOptions {
  docName: string
  userId: string
  userName: string
  userColor: string
}

/**
 * Get or create a shared Yjs document + WebSocket provider.
 * Reference-counted so multiple editors can share the same connection.
 */
export function getCollaborationProvider(options: CollaborationOptions): {
  doc: Y.Doc
  provider: WebsocketProvider
} {
  const existing = providers.get(options.docName)
  if (existing) {
    existing.refCount++
    // Update awareness with current user info
    existing.provider.awareness.setLocalStateField('user', {
      name: options.userName,
      color: options.userColor,
      userId: options.userId,
    })
    return { doc: existing.doc, provider: existing.provider }
  }

  const doc = new Y.Doc()
  const provider = new WebsocketProvider(YJS_WS_URL, options.docName, doc, {
    connect: true,
    maxBackoffTime: 10000,
  })

  // Set user awareness
  provider.awareness.setLocalStateField('user', {
    name: options.userName,
    color: options.userColor,
    userId: options.userId,
  })

  const entry: ProviderEntry = {
    doc,
    provider,
    refCount: 1,
  }

  providers.set(options.docName, entry)
  return { doc, provider }
}

/**
 * Release a reference to a collaboration provider.
 * The provider is destroyed when no more references exist.
 */
export function releaseCollaborationProvider(docName: string): void {
  const entry = providers.get(docName)
  if (!entry) return

  entry.refCount--
  if (entry.refCount <= 0) {
    entry.provider.awareness.setLocalState(null)
    entry.provider.disconnect()
    entry.provider.destroy()
    entry.doc.destroy()
    providers.delete(docName)
  }
}

/**
 * Generate a deterministic color from a user ID.
 */
export function userIdToColor(userId: string): string {
  const colors = [
    '#f87171',
    '#fb923c',
    '#fbbf24',
    '#a3e635',
    '#34d399',
    '#22d3ee',
    '#60a5fa',
    '#a78bfa',
    '#f472b6',
    '#e879f9',
  ]
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0
  }
  return colors[Math.abs(hash) % colors.length]!
}
