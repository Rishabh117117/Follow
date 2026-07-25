/**
 * Project Strand Manager
 *
 * Creates and manages project-level strands that aggregate threads
 * from multiple document strands within a project (space).
 *
 * When a document is added to a project, its strand's threads get
 * cross-referenced into the project strand via strandThreadRefs
 * with lower relevance weights.
 */

import { db } from '../db/index'
import {
  strands,
  strandThreadRefs,
  threads,
} from '../db/schema/index'
import { spaces, spaceDocuments } from '../db/schema/spaces'
import { externalDocuments } from '../db/schema/external-documents'
import { files } from '../db/schema/files'
import { eq, and, sql, inArray } from 'drizzle-orm'

// ─── Types ────────────────────────────────────────────────────────────────

export interface ProjectStrandResult {
  strandId: string
  documentCount: number
}

// ─── In-Memory Cache (5-min TTL) ──────────────────────────────────────────

interface CacheEntry {
  result: ProjectStrandResult
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CacheEntry>()

function getCached(spaceId: string): ProjectStrandResult | null {
  const entry = cache.get(spaceId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(spaceId)
    return null
  }
  return entry.result
}

function setCache(spaceId: string, result: ProjectStrandResult): void {
  cache.set(spaceId, { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ─── Main Entry Point ─────────────────────────────────────────────────────

/**
 * Ensure a project-level strand exists for the given space.
 * Creates the strand if it doesn't exist and links it to the space.
 */
export async function ensureProjectStrand(
  workspaceId: string,
  ownerId: string,
  spaceId: string,
  projectName: string
): Promise<ProjectStrandResult> {
  const cached = getCached(spaceId)
  if (cached) return cached

  // Check if space already has a strand
  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1)

  if (space?.strandId) {
    const result: ProjectStrandResult = { strandId: space.strandId, documentCount: 0 }
    setCache(spaceId, result)
    return result
  }

  // Create project strand
  const [strand] = await db
    .insert(strands)
    .values({
      workspaceId,
      ownerId,
      name: `Project: ${projectName}`,
      color: '#6366F1',
      status: 'active',
      foundingContext: `Project strand aggregating activity across all documents in project "${projectName}".`,
      metadata: { spaceId, autoCreated: true, type: 'project', createdBy: 'project-strand-manager' },
    })
    .returning()

  if (!strand) throw new Error('Failed to create project strand')

  // Link strand to space
  await db
    .update(spaces)
    .set({ strandId: strand.id, updatedAt: new Date() })
    .where(eq(spaces.id, spaceId))

  const result: ProjectStrandResult = { strandId: strand.id, documentCount: 0 }
  setCache(spaceId, result)

  console.info(
    `[ProjectStrandManager] Created project strand ${strand.id} for space ${spaceId}`
  )

  return result
}

/**
 * Link a document's strand threads to the project strand.
 * Called when a document (file or external doc) is added to a project.
 */
export async function linkDocumentToProjectStrand(
  projectStrandId: string,
  documentStrandId: string,
  addedBy: string
): Promise<void> {
  // Get all threads in the document strand
  const docThreadRefs = await db
    .select({ threadId: strandThreadRefs.threadId })
    .from(strandThreadRefs)
    .where(eq(strandThreadRefs.strandId, documentStrandId))

  if (docThreadRefs.length === 0) return

  // Link each document thread to the project strand with lower weight
  for (const ref of docThreadRefs) {
    // Check if already linked
    const [existing] = await db
      .select()
      .from(strandThreadRefs)
      .where(
        and(
          eq(strandThreadRefs.strandId, projectStrandId),
          eq(strandThreadRefs.threadId, ref.threadId)
        )
      )
      .limit(1)

    if (existing) continue

    await db.insert(strandThreadRefs).values({
      strandId: projectStrandId,
      threadId: ref.threadId,
      addedBy,
      visibleToCollaborators: true,
      relevanceWeight: 0.6, // Lower weight than primary strand
    })
  }

  console.info(
    `[ProjectStrandManager] Linked ${docThreadRefs.length} threads from strand ${documentStrandId} to project strand ${projectStrandId}`
  )
}

/**
 * Unlink a document's strand threads from the project strand.
 * Called when a document is removed from a project.
 */
export async function unlinkDocumentFromProjectStrand(
  projectStrandId: string,
  documentStrandId: string
): Promise<void> {
  const docThreadRefs = await db
    .select({ threadId: strandThreadRefs.threadId })
    .from(strandThreadRefs)
    .where(eq(strandThreadRefs.strandId, documentStrandId))

  if (docThreadRefs.length === 0) return

  const threadIds = docThreadRefs.map((r) => r.threadId)

  await db
    .delete(strandThreadRefs)
    .where(
      and(
        eq(strandThreadRefs.strandId, projectStrandId),
        inArray(strandThreadRefs.threadId, threadIds)
      )
    )

  console.info(
    `[ProjectStrandManager] Unlinked ${threadIds.length} threads from project strand ${projectStrandId}`
  )
}

// ─── Cache Management ─────────────────────────────────────────────────────

export function clearProjectStrandCache(): void {
  cache.clear()
}
