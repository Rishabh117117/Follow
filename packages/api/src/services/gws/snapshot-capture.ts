/**
 * GWS Snapshot Capture Service (Sprint IX-9)
 *
 * Captures point-in-time content snapshots of Google Workspace documents
 * into the `gws_snapshots` table, with per-doc version numbering, sha256
 * content hashing, previous-hash chain linkage, and simple diff summaries.
 *
 * Google owns the document — Follow only sees behavioral signals. These
 * snapshots give us our own versioned history so the provenance chain
 * can trace AI understanding back to the exact state of a Google Doc
 * when an index record was built.
 *
 * Paired with IX-8's `source_file_id` + `source_version` + `source_content_hash`
 * columns on `index_records`.
 */

import { db } from '../../db/index'
import { and, eq, desc, asc, lte } from 'drizzle-orm'
import { gwsSnapshots } from '../../db/schema/semantic-index'
import { computeContentHash } from '../semantic-index/content-hash'

// ─── Types ───────────────────────────────────────────────────────────────────

export type GwsDocType = 'document' | 'spreadsheet' | 'presentation'
export type GwsTriggerType = 'periodic' | 'significant_edit' | 'manual' | 'pre_share'

export interface SnapshotInput {
  workspaceId: string
  userId: string
  externalDocId: string
  docType: GwsDocType
  content: string
  title?: string
  triggerType: GwsTriggerType
  metadata?: Record<string, unknown>
}

export interface SnapshotResult {
  id: string
  version: number
  contentHash: string
  isNew: boolean
  diffSummary?: string
}

// ─── Capture ─────────────────────────────────────────────────────────────────

/**
 * Capture a point-in-time content snapshot of a Google document.
 *
 * Dedup: if the content hash matches the most recent snapshot, returns
 * `isNew: false` without inserting. Otherwise creates a new snapshot
 * with `version = lastVersion + 1`, links `previousHash` to the prior
 * snapshot's `contentHash`, and computes a simple diff summary.
 */
export async function captureGwsSnapshot(
  input: SnapshotInput
): Promise<SnapshotResult> {
  const contentHash = computeContentHash(input.content)

  // Get the most recent snapshot for this doc
  const [lastSnapshot] = await db
    .select()
    .from(gwsSnapshots)
    .where(
      and(
        eq(gwsSnapshots.workspaceId, input.workspaceId),
        eq(gwsSnapshots.externalDocId, input.externalDocId)
      )
    )
    .orderBy(desc(gwsSnapshots.version))
    .limit(1)

  // Dedup: if content hash matches last snapshot, skip
  if (lastSnapshot && lastSnapshot.contentHash === contentHash) {
    return {
      id: lastSnapshot.id,
      version: lastSnapshot.version,
      contentHash: lastSnapshot.contentHash,
      isNew: false,
    }
  }

  const newVersion = lastSnapshot ? lastSnapshot.version + 1 : 1
  const previousHash = lastSnapshot?.contentHash ?? null

  // Diff summary vs previous snapshot (null for first snapshot)
  const diffSummary: string | null = lastSnapshot
    ? computeSimpleDiff(lastSnapshot.content, input.content)
    : null

  // Insert new snapshot
  const [inserted] = await db
    .insert(gwsSnapshots)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      externalDocId: input.externalDocId,
      docType: input.docType,
      version: newVersion,
      content: input.content,
      contentHash,
      previousHash,
      diffSummary,
      triggerType: input.triggerType,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.title ? { title: input.title } : {}),
      },
    })
    .returning({ id: gwsSnapshots.id })

  return {
    id: inserted!.id,
    version: newVersion,
    contentHash,
    isNew: true,
    diffSummary: diffSummary ?? undefined,
  }
}

// ─── Retrieval ───────────────────────────────────────────────────────────────

/**
 * Get the snapshot at a specific version number, or the nearest snapshot
 * at-or-before a timestamp. Returns null if none found.
 */
export async function getGwsSnapshot(
  workspaceId: string,
  externalDocId: string,
  versionOrTimestamp: number | Date
): Promise<typeof gwsSnapshots.$inferSelect | null> {
  if (typeof versionOrTimestamp === 'number') {
    const [row] = await db
      .select()
      .from(gwsSnapshots)
      .where(
        and(
          eq(gwsSnapshots.workspaceId, workspaceId),
          eq(gwsSnapshots.externalDocId, externalDocId),
          eq(gwsSnapshots.version, versionOrTimestamp)
        )
      )
      .limit(1)
    return row ?? null
  }

  // Timestamp: find nearest snapshot at-or-before that time
  const [row] = await db
    .select()
    .from(gwsSnapshots)
    .where(
      and(
        eq(gwsSnapshots.workspaceId, workspaceId),
        eq(gwsSnapshots.externalDocId, externalDocId),
        lte(gwsSnapshots.createdAt, versionOrTimestamp)
      )
    )
    .orderBy(desc(gwsSnapshots.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * Get the latest snapshot for a document (highest version).
 */
export async function getLatestGwsSnapshot(
  workspaceId: string,
  externalDocId: string
): Promise<typeof gwsSnapshots.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(gwsSnapshots)
    .where(
      and(
        eq(gwsSnapshots.workspaceId, workspaceId),
        eq(gwsSnapshots.externalDocId, externalDocId)
      )
    )
    .orderBy(desc(gwsSnapshots.version))
    .limit(1)
  return row ?? null
}

// ─── Chain Verification ──────────────────────────────────────────────────────

/**
 * Verify the hash chain integrity for a document's snapshot history.
 * Returns `{ valid: true }` if every snapshot's `previousHash` matches
 * the `contentHash` of the snapshot at `version - 1`, else returns
 * `{ valid: false, brokenAt: N }` where N is the version where the
 * chain was first broken.
 */
export async function verifySnapshotChain(
  workspaceId: string,
  externalDocId: string
): Promise<{ valid: boolean; brokenAt?: number }> {
  const snapshots = await db
    .select({
      version: gwsSnapshots.version,
      contentHash: gwsSnapshots.contentHash,
      previousHash: gwsSnapshots.previousHash,
    })
    .from(gwsSnapshots)
    .where(
      and(
        eq(gwsSnapshots.workspaceId, workspaceId),
        eq(gwsSnapshots.externalDocId, externalDocId)
      )
    )
    .orderBy(asc(gwsSnapshots.version))

  for (let i = 1; i < snapshots.length; i++) {
    const curr = snapshots[i]!
    const prev = snapshots[i - 1]!
    if (curr.previousHash !== prev.contentHash) {
      return { valid: false, brokenAt: curr.version }
    }
  }

  return { valid: true }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simple diff summary — character-level length change + first-divergence
 * snippet. Not a full diff algorithm; just enough for human-readable
 * provenance strings in the snapshot history.
 */
function computeSimpleDiff(oldContent: string, newContent: string): string {
  const charDiff = newContent.length - oldContent.length
  const absDiff = Math.abs(charDiff)
  const direction = charDiff > 0 ? 'added' : charDiff < 0 ? 'removed' : 'modified'

  // Find first divergence point
  let divergeIdx = 0
  const minLen = Math.min(oldContent.length, newContent.length)
  while (divergeIdx < minLen && oldContent[divergeIdx] === newContent[divergeIdx]) {
    divergeIdx++
  }

  if (charDiff === 0 && divergeIdx === minLen) return 'no change'

  // Extract ~40 chars around the divergence for context
  const contextStart = Math.max(0, divergeIdx - 20)
  const snippet = newContent.substring(contextStart, contextStart + 40).replace(/\n/g, ' ')

  return `${direction} ~${absDiff} chars near: "…${snippet}…"`
}

/**
 * Map extension docType values ('docs'|'sheets'|'slides') to the
 * canonical GwsDocType values stored in `gws_snapshots.doc_type`.
 */
export function normalizeDocType(docType: string | undefined): GwsDocType {
  switch (docType) {
    case 'sheets':
    case 'spreadsheet':
      return 'spreadsheet'
    case 'slides':
    case 'presentation':
      return 'presentation'
    case 'docs':
    case 'document':
    default:
      return 'document'
  }
}
