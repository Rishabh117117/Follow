/**
 * Document Strand Manager
 *
 * Idempotent service that auto-creates a per-document strand + typed threads
 * (doc, ai, browser, user) when activity is detected on a document.
 *
 * The document becomes the "home reference point" — all activity threads
 * are anchored to it through a shared strand.
 */

import { db } from '../db/index'
import {
  threads,
  strands,
  strandThreadRefs,
  strandCollaborators,
  threadSessions,
} from '../db/schema/index'
import { documentTrackers } from '../db/schema/external-documents'
import { users } from '../db/schema/users'
import { eq, and, sql, inArray } from 'drizzle-orm'

// ─── Types ────────────────────────────────────────────────────────────────

export interface DocumentStrandResult {
  strandId: string
  threads: {
    doc: string
    ai: string
    browser: string
    user: string
  }
}

type ThreadType = 'doc' | 'ai' | 'browser' | 'user'

const THREAD_TYPES: ThreadType[] = ['doc', 'ai', 'browser', 'user']

const THREAD_NAMES: Record<ThreadType, string> = {
  doc: 'Document Edits',
  ai: 'AI Interactions',
  browser: 'Web Browsing',
  user: 'User Activity',
}

// ─── In-Memory Cache (5-min TTL) ──────────────────────────────────────────

interface CacheEntry {
  result: DocumentStrandResult
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry>()

function getCached(fileId: string): DocumentStrandResult | null {
  const entry = cache.get(fileId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(fileId)
    return null
  }
  return entry.result
}

function setCache(fileId: string, result: DocumentStrandResult): void {
  cache.set(fileId, { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ─── Main Entry Point ─────────────────────────────────────────────────────

/**
 * Ensure a document strand + 4 typed threads exist for the given file.
 * Idempotent — safe to call on every signal ingestion.
 */
export async function ensureDocumentStrand(
  workspaceId: string,
  ownerId: string,
  fileId: string,
  fileName?: string
): Promise<DocumentStrandResult> {
  // 1. Check cache first
  const cached = getCached(fileId)
  if (cached) return cached

  // 2. Check DB for existing strand
  const existing = await findExistingDocumentStrand(workspaceId, fileId)
  if (existing) {
    setCache(fileId, existing)
    return existing
  }

  // 3. Create strand + threads + refs
  const result = await createDocumentStrand(workspaceId, ownerId, fileId, fileName)
  setCache(fileId, result)

  console.info(
    `[DocumentStrandManager] Created strand ${result.strandId} for file ${fileId} with 4 threads`
  )

  return result
}

/**
 * Look up an existing auto-created document strand by fileId.
 */
async function findExistingDocumentStrand(
  workspaceId: string,
  fileId: string
): Promise<DocumentStrandResult | null> {
  const [strand] = await db
    .select()
    .from(strands)
    .where(
      and(
        eq(strands.workspaceId, workspaceId),
        sql`${strands.metadata}->>'fileId' = ${fileId}`,
        sql`${strands.metadata}->>'autoCreated' = 'true'`
      )
    )
    .limit(1)

  if (!strand) return null

  const refs = await db
    .select({ threadId: strandThreadRefs.threadId })
    .from(strandThreadRefs)
    .where(eq(strandThreadRefs.strandId, strand.id))

  const threadIds = refs.map((r) => r.threadId)
  if (threadIds.length === 0) return null

  const threadRows = await db
    .select()
    .from(threads)
    .where(inArray(threads.id, threadIds))

  const threadMap: Record<string, string> = {}
  for (const t of threadRows) {
    threadMap[t.type] = t.id
  }

  if (!threadMap.doc || !threadMap.ai || !threadMap.browser || !threadMap.user) {
    return null
  }

  return {
    strandId: strand.id,
    threads: {
      doc: threadMap.doc,
      ai: threadMap.ai,
      browser: threadMap.browser,
      user: threadMap.user,
    },
  }
}

/**
 * Create a new document strand with 4 typed threads.
 */
async function createDocumentStrand(
  workspaceId: string,
  ownerId: string,
  fileId: string,
  fileName?: string
): Promise<DocumentStrandResult> {
  const strandName = fileName ? `Work on: ${fileName}` : 'Document Work'

  const [strand] = await db
    .insert(strands)
    .values({
      workspaceId,
      ownerId,
      name: strandName,
      status: 'active',
      foundingContext: `Auto-created strand for document ${fileName || fileId}. Tracks all activity (edits, AI interactions, web browsing, user behavior) anchored to this document.`,
      metadata: { fileId, autoCreated: true, createdBy: 'document-strand-manager' },
    })
    .returning()

  if (!strand) throw new Error('Failed to create strand')

  const threadResults: Record<string, string> = {}

  for (const type of THREAD_TYPES) {
    const [thread] = await db
      .insert(threads)
      .values({
        workspaceId,
        ownerId,
        type,
        name: THREAD_NAMES[type],
        status: 'active',
        homeStrandId: strand.id,
        metadata: { fileId, autoCreated: true },
      })
      .returning()

    if (!thread) throw new Error(`Failed to create ${type} thread`)
    threadResults[type] = thread.id
  }

  for (const type of THREAD_TYPES) {
    await db.insert(strandThreadRefs).values({
      strandId: strand.id,
      threadId: threadResults[type]!,
      addedBy: ownerId,
      visibleToCollaborators: true,
    })
  }

  return {
    strandId: strand.id,
    threads: {
      doc: threadResults.doc!,
      ai: threadResults.ai!,
      browser: threadResults.browser!,
      user: threadResults.user!,
    },
  }
}

// ─── Thread Session Helper ────────────────────────────────────────────────

/**
 * Ensure an active thread session exists for the given thread + recording session.
 */
export async function ensureThreadSession(
  threadId: string,
  recordingSessionId: string
): Promise<string> {
  const [existing] = await db
    .select()
    .from(threadSessions)
    .where(
      and(
        eq(threadSessions.threadId, threadId),
        eq(threadSessions.status, 'active'),
        eq(threadSessions.recordingSessionId, recordingSessionId)
      )
    )
    .limit(1)

  if (existing) return existing.id

  const [session] = await db
    .insert(threadSessions)
    .values({
      threadId,
      recordingSessionId,
      status: 'active',
    })
    .returning()

  if (!session) throw new Error('Failed to create thread session')
  return session.id
}

// ─── Multi-User: Join Existing Document Strand ───────────────────────────

/**
 * Add a second (or Nth) user to an existing document strand.
 * Creates per-user threads and a documentTrackers record.
 *
 * Returns the per-user thread IDs for signal routing.
 */
export async function joinDocumentStrand(
  workspaceId: string,
  userId: string,
  externalDocumentId: string,
  strandId: string,
  userName?: string
): Promise<DocumentStrandResult> {
  // Check if user already has a tracker
  const [existing] = await db
    .select()
    .from(documentTrackers)
    .where(
      and(
        eq(documentTrackers.externalDocumentId, externalDocumentId),
        eq(documentTrackers.userId, userId),
        eq(documentTrackers.isActive, true)
      )
    )
    .limit(1)

  if (existing) {
    return {
      strandId,
      threads: {
        doc: existing.docThreadId!,
        ai: existing.aiThreadId!,
        browser: existing.browserThreadId!,
        user: existing.userThreadId!,
      },
    }
  }

  // Get user's display name
  let displayName = userName
  if (!displayName) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    displayName = user?.name ?? 'User'
  }

  // Create 4 per-user threads
  const threadResults: Record<string, string> = {}

  for (const type of THREAD_TYPES) {
    const [thread] = await db
      .insert(threads)
      .values({
        workspaceId,
        ownerId: userId,
        type,
        name: `${THREAD_NAMES[type]} (${displayName})`,
        status: 'active',
        homeStrandId: strandId,
        metadata: { externalDocumentId, autoCreated: true, userId },
      })
      .returning()

    if (!thread) throw new Error(`Failed to create ${type} thread for user ${userId}`)
    threadResults[type] = thread.id

    // Link to strand
    await db.insert(strandThreadRefs).values({
      strandId,
      threadId: thread.id,
      addedBy: userId,
      visibleToCollaborators: true,
    })
  }

  // Create tracker record
  await db.insert(documentTrackers).values({
    externalDocumentId,
    userId,
    role: 'collaborator',
    docThreadId: threadResults.doc!,
    aiThreadId: threadResults.ai!,
    browserThreadId: threadResults.browser!,
    userThreadId: threadResults.user!,
  })

  // Add as strand collaborator
  const [existingCollab] = await db
    .select()
    .from(strandCollaborators)
    .where(
      and(
        eq(strandCollaborators.strandId, strandId),
        eq(strandCollaborators.userId, userId)
      )
    )
    .limit(1)

  if (!existingCollab) {
    // Find strand owner for invitedBy
    const [strand] = await db.select().from(strands).where(eq(strands.id, strandId)).limit(1)

    await db.insert(strandCollaborators).values({
      strandId,
      userId,
      canSeeUserThread: false,
      canSeeAiThread: true,
      canSeeDocThreads: true,
      canSeeBrowserThread: false,
      invitedBy: strand?.ownerId ?? userId,
    })
  }

  console.info(
    `[DocumentStrandManager] User ${userId} (${displayName}) joined strand ${strandId} with 4 threads`
  )

  return {
    strandId,
    threads: {
      doc: threadResults.doc!,
      ai: threadResults.ai!,
      browser: threadResults.browser!,
      user: threadResults.user!,
    },
  }
}

/**
 * Get the per-user thread IDs for a user tracking a document.
 */
export async function getUserDocumentThreads(
  externalDocumentId: string,
  userId: string
): Promise<DocumentStrandResult | null> {
  const [tracker] = await db
    .select()
    .from(documentTrackers)
    .where(
      and(
        eq(documentTrackers.externalDocumentId, externalDocumentId),
        eq(documentTrackers.userId, userId),
        eq(documentTrackers.isActive, true)
      )
    )
    .limit(1)

  if (!tracker || !tracker.docThreadId || !tracker.aiThreadId || !tracker.browserThreadId || !tracker.userThreadId) {
    return null
  }

  // Get the strand from the external document
  const { externalDocuments } = await import('../db/schema/external-documents')
  const [doc] = await db
    .select()
    .from(externalDocuments)
    .where(eq(externalDocuments.id, externalDocumentId))
    .limit(1)

  return {
    strandId: doc?.strandId ?? '',
    threads: {
      doc: tracker.docThreadId,
      ai: tracker.aiThreadId,
      browser: tracker.browserThreadId,
      user: tracker.userThreadId,
    },
  }
}

// ─── Cache Management ─────────────────────────────────────────────────────

export function clearStrandCache(): void {
  cache.clear()
}

export function getStrandCacheStats(): { size: number; entries: string[] } {
  return {
    size: cache.size,
    entries: Array.from(cache.keys()),
  }
}
