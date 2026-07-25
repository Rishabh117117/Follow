/**
 * MCP Tool: read_file (Sprint MCP-1, upgraded MCP-2)
 *
 * Reads a file from the Follow index. Searches raw files (S3-backed),
 * workspace files, and Google Doc snapshots by name or ID.
 *
 * Lookup order: raw_files → gws_snapshots → workspace files
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession, MCPDependencies } from '../types'
import { db } from '../../db/index'
import { eq, and, ilike, desc, asc } from 'drizzle-orm'
import { files } from '../../db/schema/files'
import { externalDocuments } from '../../db/schema/external-documents'
import { gwsSnapshots } from '../../db/schema/semantic-index'
import { rawFiles } from '../../db/schema/raw-files'
import { chatConversations, chatMessages } from '../../db/schema/chat'
import { isNull } from 'drizzle-orm'
import {
  resolveEffectiveBoundaries,
  summarizeConflictsForResponse,
  type Boundary,
} from '../../services/scope'
import { mcpSessionToken } from './scope-configure'
import { postFilterItems } from '../../services/reference-agent/boundary-hook'
import type { RetrievedItem } from '../../services/reference-agent/retriever'

const MAX_CONTENT_LENGTH = 30_000

export const readFileTool: MCPToolDefinition = {
  name: 'read_file',
  description:
    'Read a file from your Follow knowledge index. Searches workspace files and Google Doc snapshots by name or ID. Returns the file content and metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      file_name: {
        type: 'string',
        description: 'Name or title of the file to read (supports partial match)',
      },
      file_id: {
        type: 'string',
        description: 'Direct file ID if known',
      },
      version: {
        type: 'string',
        enum: ['latest', 'all'],
        description: "Which version to read. Default: 'latest'",
      },
      boundaries: {
        type: 'array',
        description:
          'Optional Boundary[] override. If omitted, uses the active session scope. Governance wins on conflicts; a file that fails the scope is reported as "not found" to avoid leaking out-of-scope existence.',
        items: { type: 'object' },
      },
    },
  },
  handler: readFileHandler,
}

async function readFileHandler(
  params: Record<string, unknown>,
  session: MCPSession,
  _deps: MCPDependencies
): Promise<MCPToolResult> {
  const fileName = params.file_name as string | undefined
  const fileId = params.file_id as string | undefined
  const explicitBoundaries = params.boundaries as Boundary[] | undefined

  if (!fileName && !fileId) {
    return {
      content: [
        { type: 'text', text: 'Error: at least one of file_name or file_id must be provided.' },
      ],
      isError: true,
    }
  }

  // GOVERNANCE-AUDIT-FIX-1: resolve boundaries + governance pre-check before file lookup.
  // Governance wins: blocked boundaries surface as conflicts, not silent downgrade.
  const boundaryResult = await resolveEffectiveBoundaries({
    userId: session.userId,
    workspaceId: session.workspaceId,
    sessionToken: mcpSessionToken(session),
    explicitBoundaries,
  }).catch((err) => {
    console.warn('[MCP read_file] boundary resolution failed, continuing unscoped:', err)
    return { boundaries: [] as Boundary[], conflicts: [], unscoped: true }
  })

  if (boundaryResult.conflicts.length > 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            '[READ_FILE BLOCKED]\nReason: governance conflicts detected.' +
            summarizeConflictsForResponse(boundaryResult.conflicts),
        },
      ],
    }
  }

  const conflictTrailer = summarizeConflictsForResponse(boundaryResult.conflicts)
  const effectiveBoundaries = boundaryResult.boundaries

  // Try workspace files first
  if (fileId) {
    return readByFileId(fileId, session, effectiveBoundaries, conflictTrailer)
  }

  if (fileName) {
    return readByFileName(fileName, session, effectiveBoundaries, conflictTrailer)
  }

  return {
    content: [{ type: 'text', text: 'No file identifier provided.' }],
    isError: true,
  }
}

// ─── Governance post-filter helpers (GOVERNANCE-AUDIT-FIX-1) ────────────────
//
// Files are heterogeneous (raw files, workspace files, GWS snapshots, saved
// conversations). To reuse the reference-agent's boundary hook, we map each
// file-like into a RetrievedItem-shaped object with whichever metadata fields
// it carries. Missing fields → 'unknown' verdict → fail-closed drop.

function passesBoundaries(
  item: RetrievedItem,
  boundaries: Boundary[]
): boolean {
  if (boundaries.length === 0) return true
  const { items } = postFilterItems([item], boundaries, { failClosed: true })
  return items.length > 0
}

function scopeNotFound(query: string, conflictTrailer: string): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `No file matching your scope found for "${query}".` + conflictTrailer,
      },
    ],
  }
}

async function readByFileId(
  fileId: string,
  session: MCPSession,
  boundaries: Boundary[],
  conflictTrailer: string
): Promise<MCPToolResult> {
  // Try raw file first (MCP-2: highest priority)
  try {
    const { getRawFile } = await import('../../services/raw-file-store')
    const rawResult = await getRawFile(fileId)
    if (rawResult && rawResult.record.userId === session.userId) {
      // MCP-FIX-2: heal legacy rows with bad MIME (e.g. .ts → video/mp2t) and
      // missing extracted_text. The repair persists the corrected row + queues
      // it for indexing so the next query_index call will see it.
      const record = await maybeRepairAndReindex(rawResult.record, rawResult.content)
      if (!passesBoundaries(rawFileToItem(record, session.workspaceId), boundaries)) {
        return scopeNotFound(fileId, conflictTrailer)
      }
      let content = record.extractedText ?? rawResult.content.toString('utf-8')
      let truncated = false
      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH)
        truncated = true
      }
      let text = `**${record.fileName}** (v${record.version})\n`
      text += `Type: ${record.mimeType} | Size: ${record.fileSize} bytes\n`
      text += `Hash: ${record.contentHash.slice(0, 12)}...\n\n`
      text += content
      if (truncated) text += '\n\n[Content truncated at 30K characters.]'
      return { content: [{ type: 'text', text: text + conflictTrailer }] }
    }
  } catch {
    // Raw file store may not be available
  }

  // Try workspace file
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.workspaceId, session.workspaceId)))
    .limit(1)

  if (file) {
    if (!passesBoundaries(workspaceFileToItem(file), boundaries)) {
      return scopeNotFound(fileId, conflictTrailer)
    }
    return {
      content: [
        {
          type: 'text',
          text:
            formatFileResult({
              name: file.name,
              type: file.type,
              mimeType: file.mimeType,
              source: 'workspace',
              updatedAt: file.updatedAt?.toISOString() ?? 'unknown',
              content:
                'File content is stored in S3. Use query_index to search the indexed content of this file.',
            }) + conflictTrailer,
        },
      ],
    }
  }

  // Try GWS snapshot
  const [snapshot] = await db
    .select()
    .from(gwsSnapshots)
    .where(and(eq(gwsSnapshots.id, fileId), eq(gwsSnapshots.workspaceId, session.workspaceId)))
    .limit(1)

  if (snapshot) {
    if (!passesBoundaries(gwsSnapshotToItem(snapshot, session.workspaceId), boundaries)) {
      return scopeNotFound(fileId, conflictTrailer)
    }
    return formatSnapshotResult(snapshot, conflictTrailer)
  }

  // MCP-FIX-1: saved conversations (from save_conversation) live in
  // chatConversations and are readable by their UUID.
  const conversationResult = await readConversationById(fileId, session, boundaries, conflictTrailer)
  if (conversationResult) return conversationResult

  return notFoundResult(fileId)
}

async function readByFileName(
  fileName: string,
  session: MCPSession,
  boundaries: Boundary[],
  conflictTrailer: string
): Promise<MCPToolResult> {
  // Try raw files first (MCP-2: highest priority)
  try {
    const { getRawFileByName, getRawFile } = await import('../../services/raw-file-store')
    let rawFile = await getRawFileByName(session.userId, session.workspaceId, fileName)
    if (rawFile) {
      // MCP-FIX-2: legacy rows may have wrong MIME + null extractedText. Try
      // to repair on read by downloading the buffer and re-running extraction.
      const wouldBeFixed =
        rawFile.extractedText === null ||
        rawFile.extractedText.length === 0
      if (wouldBeFixed) {
        try {
          const fetched = await getRawFile(rawFile.id)
          if (fetched) {
            const repaired = await maybeRepairAndReindex(fetched.record, fetched.content)
            rawFile = repaired
          }
        } catch (err) {
          console.warn('[MCP] Repair on read failed (continuing with stored row):', err)
        }
      }
      if (!passesBoundaries(rawFileToItem(rawFile, session.workspaceId), boundaries)) {
        return scopeNotFound(fileName, conflictTrailer)
      }
      let content = rawFile.extractedText ?? '[Binary file — no text extracted]'
      let truncated = false
      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH)
        truncated = true
      }
      let text = `**${rawFile.fileName}** (v${rawFile.version})\n`
      text += `Type: ${rawFile.mimeType} | Size: ${rawFile.fileSize} bytes\n`
      text += `Hash: ${rawFile.contentHash.slice(0, 12)}...\n\n`
      text += content
      if (truncated) text += '\n\n[Content truncated at 30K characters.]'
      return { content: [{ type: 'text', text: text + conflictTrailer }] }
    }
  } catch {
    // Raw file store may not be available
  }

  // Search workspace files by name
  const matchedFiles = await db
    .select()
    .from(files)
    .where(and(ilike(files.name, `%${fileName}%`), eq(files.workspaceId, session.workspaceId)))
    .limit(5)

  if (matchedFiles.length > 0) {
    if (matchedFiles.length > 1) {
      let text = `Found ${matchedFiles.length} files matching "${fileName}":\n\n`
      for (const f of matchedFiles) {
        text += `- ${f.name} (${f.type}, ID: ${f.id})\n`
      }
      text +=
        '\nReturning the first match. Use file_id to read a specific file.'
      return { content: [{ type: 'text', text: text + conflictTrailer }] }
    }
    const matched = matchedFiles[0]!
    if (!passesBoundaries(workspaceFileToItem(matched), boundaries)) {
      return scopeNotFound(fileName, conflictTrailer)
    }
    return {
      content: [
        {
          type: 'text',
          text:
            formatFileResult({
              name: matched.name,
              type: matched.type,
              mimeType: matched.mimeType,
              source: 'workspace',
              updatedAt: matched.updatedAt?.toISOString() ?? 'unknown',
              content:
                'File content is stored in S3. Use query_index to search the indexed content of this file.',
            }) + conflictTrailer,
        },
      ],
    }
  }

  // MCP-FIX-1: search saved conversations by title before falling through
  // to external document search. Conversations saved via save_conversation
  // are stored in chatConversations and must be readable by their title.
  const conversationResult = await readConversationByTitle(fileName, session, boundaries, conflictTrailer)
  if (conversationResult) return conversationResult

  // Search Google Doc snapshots by title
  const matchedDocs = await db
    .select()
    .from(externalDocuments)
    .where(
      and(
        ilike(externalDocuments.title, `%${fileName}%`),
        eq(externalDocuments.workspaceId, session.workspaceId)
      )
    )
    .limit(5)

  if (matchedDocs.length > 0) {
    const doc = matchedDocs[0]!

    // Get latest snapshot for this doc
    try {
      const { getLatestGwsSnapshot } = await import(
        '../../services/gws/snapshot-capture'
      )
      const snapshot = await getLatestGwsSnapshot(session.workspaceId, doc.externalDocId)
      if (snapshot) {
        if (!passesBoundaries(gwsSnapshotToItem(snapshot, session.workspaceId), boundaries)) {
          return scopeNotFound(fileName, conflictTrailer)
        }
        return formatSnapshotResult(snapshot, conflictTrailer)
      }
    } catch {
      // Snapshot service may not be available
    }

    if (!passesBoundaries(externalDocToItem(doc, session.workspaceId), boundaries)) {
      return scopeNotFound(fileName, conflictTrailer)
    }
    return {
      content: [
        {
          type: 'text',
          text:
            formatFileResult({
              name: doc.title,
              type: doc.docType,
              mimeType: null,
              source: 'google-docs',
              updatedAt: doc.updatedAt?.toISOString() ?? 'unknown',
              content: 'No snapshot available. The document may not have been synced recently.',
            }) + conflictTrailer,
        },
      ],
    }
  }

  return notFoundResult(fileName)
}

// ─── File → RetrievedItem mapping (GOVERNANCE-AUDIT-FIX-1) ──────────────────
//
// Each map populates whichever metadata dimensions the file-type carries.
// Missing dimensions produce 'unknown' in the boundary hook → fail-closed
// drop. That is intended behavior: a boundary the data can't satisfy is a
// boundary the data can't satisfy.

function rawFileToItem(
  record: import('../../services/raw-file-store').RawFileRecord,
  workspaceId: string
): RetrievedItem {
  return {
    source: 'index_records',
    content: record.fileName,
    citation: {
      sourceFileId: record.id,
      timestamp: (record as { updatedAt?: Date }).updatedAt?.toISOString(),
      label: record.fileName,
    },
    metadata: {
      contributorId: record.userId,
      workspaceId,
      indexId: workspaceId,
      sourceTool: 'raw_file',
    },
  }
}

function workspaceFileToItem(file: {
  id: string
  name: string
  workspaceId: string
  createdBy?: string | null
  updatedAt: Date | null
}): RetrievedItem {
  return {
    source: 'index_records',
    content: file.name,
    citation: {
      sourceFileId: file.id,
      timestamp: file.updatedAt?.toISOString(),
      label: file.name,
    },
    metadata: {
      contributorId: file.createdBy ?? undefined,
      workspaceId: file.workspaceId,
      indexId: file.workspaceId,
      sourceTool: 'workspace_file',
    },
  }
}

function gwsSnapshotToItem(
  snapshot: { id: string; workspaceId?: string; createdAt: Date; externalDocId: string },
  workspaceId: string
): RetrievedItem {
  return {
    source: 'gws_snapshots',
    content: snapshot.externalDocId,
    citation: {
      sourceFileId: snapshot.id,
      timestamp: snapshot.createdAt.toISOString(),
      label: snapshot.externalDocId,
    },
    metadata: {
      workspaceId: snapshot.workspaceId ?? workspaceId,
      indexId: snapshot.workspaceId ?? workspaceId,
      sourceTool: 'gws_snapshot',
    },
  }
}

function externalDocToItem(
  doc: { id: string; workspaceId: string; title: string; updatedAt: Date | null },
  workspaceId: string
): RetrievedItem {
  return {
    source: 'gws_snapshots',
    content: doc.title,
    citation: {
      sourceFileId: doc.id,
      timestamp: doc.updatedAt?.toISOString(),
      label: doc.title,
    },
    metadata: {
      workspaceId: doc.workspaceId ?? workspaceId,
      indexId: doc.workspaceId ?? workspaceId,
      sourceTool: 'external_doc',
    },
  }
}

function conversationToItem(conv: {
  id: string
  title: string
  workspaceId?: string
  userId?: string | null
  createdAt: Date | null
  updatedAt: Date | null
  chatSourceType: string | null
}): RetrievedItem {
  return {
    source: 'chat_history',
    content: conv.title,
    citation: {
      sourceFileId: conv.id,
      timestamp: (conv.updatedAt ?? conv.createdAt)?.toISOString(),
      label: conv.title,
    },
    metadata: {
      contributorId: conv.userId ?? undefined,
      workspaceId: conv.workspaceId,
      indexId: conv.workspaceId,
      sourceTool: conv.chatSourceType ?? 'saved_conversation',
    },
  }
}

function formatSnapshotResult(
  snapshot: {
    content: string
    version: number
    contentHash: string
    docType: string
    createdAt: Date
    externalDocId: string
  },
  conflictTrailer = ''
): MCPToolResult {
  let content = snapshot.content
  let truncated = false

  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH)
    truncated = true
  }

  let text = `**Google ${snapshot.docType}** (Version ${snapshot.version})\n`
  text += `Hash: ${snapshot.contentHash.slice(0, 12)}...\n`
  text += `Captured: ${snapshot.createdAt.toISOString()}\n\n`
  text += content

  if (truncated) {
    text +=
      '\n\n[Content truncated at 30K characters. Use query_index to search specific sections.]'
  }

  return { content: [{ type: 'text', text: text + conflictTrailer }] }
}

function formatFileResult(file: {
  name: string
  type: string
  mimeType: string | null
  source: string
  updatedAt: string
  content: string
}): string {
  let text = `**${file.name}**\n`
  text += `Type: ${file.type}`
  if (file.mimeType) text += ` (${file.mimeType})`
  text += `\nSource: ${file.source}\n`
  text += `Last updated: ${file.updatedAt}\n\n`
  text += file.content
  return text
}

function notFoundResult(query: string): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `No file found matching "${query}". Try a different name or use query_index to search by content.`,
      },
    ],
  }
}

// ─── Legacy raw-file repair on read (MCP-FIX-2) ─────────────────────────────
//
// Files ingested before MIME normalization landed have wrong mime_type values
// (e.g. `.ts` stored as `video/mp2t`) and null `extracted_text`. When read_file
// encounters such a row, this helper:
//   1. Persists the corrected MIME + extracted text to the DB
//   2. Queues the file for re-indexing so query_index will see it
// Result is the corrected RawFileRecord, used in place of the original.

async function maybeRepairAndReindex(
  record: import('../../services/raw-file-store').RawFileRecord,
  content: Buffer
): Promise<import('../../services/raw-file-store').RawFileRecord> {
  const { repairRawFileMime } = await import('../../services/raw-file-store')
  const repaired = await repairRawFileMime(record, content)

  const wasRepaired =
    repaired.mimeType !== record.mimeType ||
    (repaired.extractedText && !record.extractedText)

  if (wasRepaired && repaired.extractedText && repaired.extractedText.length > 0) {
    try {
      const { queueFileIndex } = await import('../../services/indexing/file-indexer')
      queueFileIndex({
        fileId: repaired.id,
        workspaceId: repaired.workspaceId,
        content: repaired.extractedText,
        isNew: false,
        fileName: repaired.fileName,
        fileSize: repaired.fileSize,
        filePath: repaired.filePath,
      })
    } catch (err) {
      console.warn('[MCP] Re-queue indexing after repair failed:', err)
    }
  }

  return repaired
}

// ─── Saved-conversation readers (MCP-FIX-1) ─────────────────────────────────
//
// save_conversation stores MCP-imported conversations in chatConversations +
// chatMessages. read_file must be able to find them by title or ID so the
// conversation is addressable after it lands in the index.

async function readConversationById(
  conversationId: string,
  session: MCPSession,
  boundaries: Boundary[],
  conflictTrailer: string
): Promise<MCPToolResult | null> {
  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.workspaceId, session.workspaceId)
      )
    )
    .limit(1)

  if (!conv) return null
  if (!passesBoundaries(conversationToItem(conv), boundaries)) {
    return scopeNotFound(conversationId, conflictTrailer)
  }
  return formatConversationResult(conv, conflictTrailer)
}

async function readConversationByTitle(
  title: string,
  session: MCPSession,
  boundaries: Boundary[],
  conflictTrailer: string
): Promise<MCPToolResult | null> {
  const matches = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        ilike(chatConversations.title, `%${title}%`),
        eq(chatConversations.workspaceId, session.workspaceId)
      )
    )
    .orderBy(desc(chatConversations.createdAt))
    .limit(5)

  if (matches.length === 0) return null

  // Filter matches by boundary first; if none survive, report scope-not-found.
  const visible = matches.filter((c) => passesBoundaries(conversationToItem(c), boundaries))
  if (visible.length === 0) {
    return scopeNotFound(title, conflictTrailer)
  }

  if (visible.length > 1) {
    let text = `Found ${visible.length} conversations matching "${title}":\n\n`
    for (const c of visible) {
      const source = c.chatSourceType ?? 'unknown'
      text += `- "${c.title}" (${source}, ID: ${c.id})\n`
    }
    text += '\nReturning the most recent match. Use file_id to read a specific conversation.'
    return { content: [{ type: 'text', text: text + conflictTrailer }] }
  }

  return formatConversationResult(visible[0]!, conflictTrailer)
}

async function formatConversationResult(
  conv: {
    id: string
    title: string
    chatSourceType: string | null
    createdAt: Date | null
    updatedAt: Date | null
    metadata: Record<string, unknown> | null
  },
  conflictTrailer = ''
): Promise<MCPToolResult> {
  // Pull metadata too — the reasoning trail (thinking, plan steps, tool
  // calls, sources, model/token/latency info) lives there. Filter out
  // superseded messages so updated conversations render only the latest
  // turn set, matching what the web UI shows.
  const messages = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
      metadata: chatMessages.metadata,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conv.id),
        isNull(chatMessages.supersededByMessageId)
      )
    )
    .orderBy(asc(chatMessages.createdAt))

  const source = conv.chatSourceType ?? 'unknown'
  let text = `**${conv.title}**\n`
  text += `Type: conversation (${source})\n`
  text += `Source: MCP-imported\n`
  text += `Last updated: ${conv.updatedAt?.toISOString() ?? 'unknown'}\n`
  text += `Messages: ${messages.length}\n\n`

  let body = ''
  for (const m of messages) {
    body += `**${m.role}:** ${m.content}\n`
    if (m.role === 'assistant') {
      const trail = renderReasoningTrail(m.metadata as Record<string, unknown> | null)
      if (trail) body += trail
    }
    body += '\n'
  }

  const MAX_LEN = 30_000
  if (body.length > MAX_LEN) {
    body = body.slice(0, MAX_LEN) + '\n\n[Conversation truncated at 30K characters.]'
  }

  return { content: [{ type: 'text', text: text + body.trim() + conflictTrailer }] }
}

/**
 * Render the reasoning-trail block for an assistant message as indented
 * markdown the LLM client can parse. Returns null when no reasoning fields
 * are present — older messages saved before the `reasoning` schema
 * extension won't carry any of these keys.
 */
function renderReasoningTrail(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  // Accept both the canonical keys and the prose-aligned aliases older rows
  // may carry (e.g. chain_of_thought, tool_invocations) so we don't drop
  // anything that was stored before normalization landed.
  const thinking =
    (meta['thinking'] as string | undefined) ??
    (meta['chain_of_thought'] as string | undefined)
  const agentIntent =
    (meta['agentIntent'] as string | undefined) ?? (meta['intent'] as string | undefined)
  const planSteps =
    (meta['planSteps'] as string[] | undefined) ?? (meta['plan'] as string[] | undefined)
  const toolCalls = ((meta['toolCalls'] as unknown) ??
    meta['tool_invocations'] ??
    undefined) as
    | Array<{
        name: string
        args?: Record<string, unknown>
        result?: unknown
        durationMs?: number
        startedAt?: string
      }>
    | undefined
  const rawSources = ((meta['sources'] as unknown) ??
    meta['citations'] ??
    undefined) as unknown[] | undefined
  const sources = rawSources ? coerceSources(rawSources) : undefined
  const model = (meta['model'] as string | undefined) ?? (meta['model_id'] as string | undefined)
  const tokensIn =
    (meta['tokensIn'] as number | undefined) ?? (meta['input_tokens'] as number | undefined)
  const tokensOut =
    (meta['tokensOut'] as number | undefined) ?? (meta['output_tokens'] as number | undefined)
  const latencyMs =
    (meta['latencyMs'] as number | undefined) ?? (meta['latency'] as number | undefined)

  const hasAny =
    thinking ||
    agentIntent ||
    (planSteps && planSteps.length > 0) ||
    (toolCalls && toolCalls.length > 0) ||
    (sources && sources.length > 0) ||
    model ||
    tokensIn != null ||
    tokensOut != null ||
    latencyMs != null
  if (!hasAny) return null

  const lines: string[] = ['  > **Reasoning trail:**']
  if (agentIntent) lines.push(`  > - Intent: ${agentIntent}`)
  if (thinking) lines.push(`  > - Thinking: ${thinking.replace(/\n/g, ' ').slice(0, 800)}`)
  if (planSteps && planSteps.length > 0) {
    lines.push(`  > - Plan:`)
    for (const step of planSteps.slice(0, 20)) {
      lines.push(`  >   • ${step}`)
    }
  }
  if (toolCalls && toolCalls.length > 0) {
    lines.push(`  > - Tool calls:`)
    for (const t of toolCalls.slice(0, 20)) {
      const args = t.args ? ` args=${JSON.stringify(t.args).slice(0, 200)}` : ''
      const dur = t.durationMs ? ` (${t.durationMs}ms)` : ''
      lines.push(`  >   • ${t.name}${args}${dur}`)
    }
  }
  if (sources && sources.length > 0) {
    lines.push(`  > - Sources:`)
    for (const s of sources.slice(0, 20)) {
      const id = s.id ? ` [${s.id}]` : ''
      const typeBit = s.type && s.type !== 'text' ? ` (${s.type})` : ''
      lines.push(`  >   • ${s.label}${typeBit}${id}`)
    }
  }
  const modelBits: string[] = []
  if (model) modelBits.push(model)
  if (tokensIn != null) modelBits.push(`${tokensIn}→`)
  if (tokensOut != null) modelBits.push(`${tokensOut} tok`)
  if (latencyMs != null) modelBits.push(`${latencyMs}ms`)
  if (modelBits.length > 0) lines.push(`  > - Model: ${modelBits.join(' · ')}`)

  return lines.join('\n') + '\n'
}

/**
 * Older rows were saved when `reasoning.sources` accepted any shape, so the
 * stored value may be plain strings, OpenAI-style `{title,url}`, or the
 * canonical `{label,type}`. Coerce everything into the render-friendly form.
 */
function coerceSources(
  input: unknown[]
): Array<{ label: string; type: string; id?: string }> {
  return input
    .map((s): { label: string; type: string; id?: string } | null => {
      if (typeof s === 'string') {
        const trimmed = s.trim()
        if (!trimmed) return null
        const isUrl = /^https?:\/\//i.test(trimmed)
        return { label: trimmed, type: isUrl ? 'url' : 'text' }
      }
      if (s && typeof s === 'object') {
        const o = s as Record<string, unknown>
        const label =
          (o['label'] as string) ||
          (o['title'] as string) ||
          (o['name'] as string) ||
          (o['url'] as string) ||
          (o['id'] as string) ||
          ''
        if (!label) return null
        const type =
          (o['type'] as string) ||
          (o['kind'] as string) ||
          (typeof o['url'] === 'string' ? 'url' : 'text')
        const id = typeof o['id'] === 'string' ? (o['id'] as string) : undefined
        return id ? { label, type, id } : { label, type }
      }
      return null
    })
    .filter((s): s is { label: string; type: string; id?: string } => s !== null)
}
