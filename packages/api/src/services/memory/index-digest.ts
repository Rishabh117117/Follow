/**
 * Index Digest (Sprint MEM-1)
 *
 * Builds a compact JSON snapshot of a user's index that the memory section
 * generator can pass to the LLM. Cheap, deterministic, and hashable — the
 * hash lets us skip regeneration when nothing has changed.
 */

import { and, desc, eq, isNull, or, inArray, ne, count, sql } from 'drizzle-orm'
import { createHash } from 'crypto'
import { db } from '../../db/index'
import { indexRecords } from '../../db/schema/semantic-index'
import { chatConversations } from '../../db/schema/chat'
import { rawFiles } from '../../db/schema/raw-files'
import { files } from '../../db/schema/files'

export interface DigestFact {
  label: string
  time: string
  magnitude: string
  threadType: string
}

export interface DigestThread {
  id: string
  title: string
  updatedAt: string
}

export interface DigestFile {
  id: string
  name: string
  updatedAt: string
  sourceType: string
}

export interface IndexDigest {
  indexId: string
  indexKind: 'personal' | 'project'
  counts: {
    facts: number
    threads: number
    files: number
  }
  recentFacts: DigestFact[]
  recentThreads: DigestThread[]
  recentFiles: DigestFile[]
  generatedAt: string
}

const FACT_LIMIT = 30
const THREAD_LIMIT = 15
const FILE_LIMIT = 15

export async function buildIndexDigest(
  userId: string,
  indexId: string
): Promise<IndexDigest> {
  const indexKind: 'personal' | 'project' = indexId === 'personal' ? 'personal' : 'project'

  if (indexKind === 'personal') {
    return buildPersonalDigest(userId, indexId)
  }
  return buildProjectDigest(indexId)
}

async function buildPersonalDigest(userId: string, indexId: string): Promise<IndexDigest> {
  const [factRows, threadRows, fileRows, factCountRow] = await Promise.all([
    db
      .select({
        label: indexRecords.embeddingText,
        time: indexRecords.eventTime,
        magnitude: indexRecords.indexMagnitude,
        threadType: indexRecords.threadType,
      })
      .from(indexRecords)
      .where(
        and(
          eq(indexRecords.userId, userId),
          eq(indexRecords.hidden, false),
          sql`${indexRecords.deletedAt} IS NULL`
        )
      )
      .orderBy(desc(indexRecords.eventTime))
      .limit(FACT_LIMIT),
    db
      .select({
        id: chatConversations.id,
        title: chatConversations.title,
        updatedAt: chatConversations.updatedAt,
      })
      .from(chatConversations)
      .where(and(eq(chatConversations.userId, userId), isNull(chatConversations.spaceId)))
      .orderBy(desc(chatConversations.updatedAt))
      .limit(THREAD_LIMIT),
    db
      .select({
        id: rawFiles.id,
        name: rawFiles.fileName,
        updatedAt: rawFiles.updatedAt,
        sourceType: rawFiles.sourceType,
      })
      .from(rawFiles)
      .where(
        and(
          eq(rawFiles.userId, userId),
          isNull(rawFiles.deletedAt),
          ne(rawFiles.sourceType, 'chat_artifact')
        )
      )
      .orderBy(desc(rawFiles.updatedAt))
      .limit(FILE_LIMIT),
    db
      .select({ cnt: count() })
      .from(indexRecords)
      .where(eq(indexRecords.userId, userId))
      .then((r) => r[0]),
  ])

  const [threadCountRow, fileCountRow] = await Promise.all([
    db
      .select({ cnt: count() })
      .from(chatConversations)
      .where(and(eq(chatConversations.userId, userId), isNull(chatConversations.spaceId)))
      .then((r) => r[0]),
    db
      .select({ cnt: count() })
      .from(rawFiles)
      .where(
        and(
          eq(rawFiles.userId, userId),
          isNull(rawFiles.deletedAt),
          ne(rawFiles.sourceType, 'chat_artifact')
        )
      )
      .then((r) => r[0]),
  ])

  return {
    indexId,
    indexKind: 'personal',
    counts: {
      facts: Number(factCountRow?.cnt ?? 0),
      threads: Number(threadCountRow?.cnt ?? 0),
      files: Number(fileCountRow?.cnt ?? 0),
    },
    recentFacts: factRows.map((r) => ({
      label: String(r.label ?? '').slice(0, 240),
      time: r.time instanceof Date ? r.time.toISOString() : String(r.time),
      magnitude: String(r.magnitude ?? 'small'),
      threadType: String(r.threadType ?? ''),
    })),
    recentThreads: threadRows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? 'Untitled'),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    })),
    recentFiles: fileRows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? 'Untitled'),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
      sourceType: String(r.sourceType ?? ''),
    })),
    generatedAt: new Date().toISOString(),
  }
}

async function buildProjectDigest(spaceId: string): Promise<IndexDigest> {
  // Resolve project-scoped threads + files, same heuristics as indexes.ts
  const convRows = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(
      or(eq(chatConversations.spaceId, spaceId), eq(chatConversations.workspaceId, spaceId))
    )
  const convIds = convRows.map((r) => r.id)

  const fileRowIds = await db
    .select({ id: files.id })
    .from(files)
    .where(or(eq(files.spaceId, spaceId), eq(files.workspaceId, spaceId)))
  const fileIds = fileRowIds.map((r) => r.id)

  const threadIds = [...convIds, ...fileIds]

  const factRowsPromise =
    threadIds.length > 0
      ? db
          .select({
            label: indexRecords.embeddingText,
            time: indexRecords.eventTime,
            magnitude: indexRecords.indexMagnitude,
            threadType: indexRecords.threadType,
          })
          .from(indexRecords)
          .where(
            and(
              inArray(indexRecords.threadId, threadIds),
              eq(indexRecords.hidden, false),
              sql`${indexRecords.deletedAt} IS NULL`
            )
          )
          .orderBy(desc(indexRecords.eventTime))
          .limit(FACT_LIMIT)
      : Promise.resolve([])

  const factCountPromise =
    threadIds.length > 0
      ? db
          .select({ cnt: count() })
          .from(indexRecords)
          .where(inArray(indexRecords.threadId, threadIds))
          .then((r) => r[0])
      : Promise.resolve({ cnt: 0 })

  const threadRowsPromise = db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .where(
      or(eq(chatConversations.spaceId, spaceId), eq(chatConversations.workspaceId, spaceId))
    )
    .orderBy(desc(chatConversations.updatedAt))
    .limit(THREAD_LIMIT)

  const fileRowsPromise = db
    .select({
      id: rawFiles.id,
      name: rawFiles.fileName,
      updatedAt: rawFiles.updatedAt,
      sourceType: rawFiles.sourceType,
    })
    .from(rawFiles)
    .where(and(eq(rawFiles.workspaceId, spaceId), isNull(rawFiles.deletedAt)))
    .orderBy(desc(rawFiles.updatedAt))
    .limit(FILE_LIMIT)

  const [factRows, threadRows, fileRows, factCount] = await Promise.all([
    factRowsPromise,
    threadRowsPromise,
    fileRowsPromise,
    factCountPromise,
  ])

  return {
    indexId: spaceId,
    indexKind: 'project',
    counts: {
      facts: Number(factCount?.cnt ?? 0),
      threads: convIds.length,
      files: fileIds.length,
    },
    recentFacts: factRows.map((r) => ({
      label: String(r.label ?? '').slice(0, 240),
      time: r.time instanceof Date ? r.time.toISOString() : String(r.time),
      magnitude: String(r.magnitude ?? 'small'),
      threadType: String(r.threadType ?? ''),
    })),
    recentThreads: threadRows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? 'Untitled'),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    })),
    recentFiles: fileRows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? 'Untitled'),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
      sourceType: String(r.sourceType ?? ''),
    })),
    generatedAt: new Date().toISOString(),
  }
}

export function hashDigest(digest: IndexDigest): string {
  // Exclude generatedAt so two snapshots of identical data hash the same.
  const stable = {
    indexId: digest.indexId,
    counts: digest.counts,
    recentFacts: digest.recentFacts,
    recentThreads: digest.recentThreads,
    recentFiles: digest.recentFiles,
  }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

export function isDigestEmpty(digest: IndexDigest): boolean {
  return (
    digest.counts.facts === 0 &&
    digest.counts.threads === 0 &&
    digest.counts.files === 0
  )
}
