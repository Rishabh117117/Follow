import { db } from '../../db/index'
import { eq, and, ilike, isNull, desc, gte } from 'drizzle-orm'
import { files, threadEvents, threads } from '../../db/schema/index'
import { externalDocuments } from '../../db/schema/external-documents'
import { webCaptures } from '../../db/schema/collaboration'
import { clickhouse } from '../../db/clickhouse'
import { DEV_USER } from '@workspace/shared/constants'
import { extractFileContent } from '../document/yjs-text-extractor'

const CONTENT_MAX_CHARS = 32_000
const SECTION_MAX_CHARS = 16_000

interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/**
 * Context passed to tool selection so we can serve the right tools
 * depending on whether the user is in a native doc or a Google Workspace doc.
 */
interface ToolContext {
  workspaceId: string
  contextObjectType?: string | null
  contextObjectId?: string | null
  /** When true, include GWS tools even without a tracked external_document */
  hasDocumentContent?: boolean
}

/**
 * Get all tool definitions for the workspace agent.
 * GWS-specific tools are included when the conversation targets a Google
 * Workspace document OR when document content is provided (e.g. from the
 * Chrome extension without tracking enabled).
 */
export function getToolDefinitions(ctx: ToolContext): ToolDef[] {
  const isGWS = ctx.contextObjectType === 'external_document' || !!ctx.hasDocumentContent
  const base: ToolDef[] = [
    {
      name: 'search_files',
      description:
        'Search for files in the workspace by name or content. Returns matching files with their names, types, and IDs.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query to match against file names' },
          limit: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_file',
      description:
        "Read a file's content and structure. For documents/notes, returns extracted text with section outline (headings, word counts). For large documents, use read_file_section to drill into specific sections.",
      input_schema: {
        type: 'object' as const,
        properties: {
          fileId: { type: 'string', description: 'The UUID of the file to read' },
        },
        required: ['fileId'],
      },
    },
    {
      name: 'read_file_section',
      description:
        'Read a specific section of a large document by index or title. Returns the full text of that section. Use after read_file to drill into a particular heading/section.',
      input_schema: {
        type: 'object' as const,
        properties: {
          fileId: { type: 'string', description: 'The UUID of the file' },
          sectionIndex: {
            type: 'number',
            description: 'Zero-based section index from the outline',
          },
          sectionTitle: {
            type: 'string',
            description:
              'Section title to match (case-insensitive). Used if sectionIndex is not provided.',
          },
        },
        required: ['fileId'],
      },
    },
    {
      name: 'create_file',
      description: 'Create a new document or note file in the workspace.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Name for the new file' },
          content: { type: 'string', description: 'Initial text content for the file' },
          fileType: {
            type: 'string',
            description: 'Type of file to create',
            enum: ['document', 'note'],
          },
          parentFolderId: {
            type: 'string',
            description: 'Parent folder ID (optional, defaults to root)',
          },
        },
        required: ['name', 'content'],
      },
    },
    {
      name: 'list_files',
      description: 'List files in a specific folder of the workspace.',
      input_schema: {
        type: 'object' as const,
        properties: {
          parentFolderId: {
            type: 'string',
            description: 'Folder ID to list files from. Omit for root folder.',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_timeline_summary',
      description:
        'Get a summary of recent workspace activity based on thread events. Useful for understanding what users have been working on.',
      input_schema: {
        type: 'object' as const,
        properties: {
          hours: {
            type: 'number',
            description: 'How many hours of activity to look back (default 24, max 168)',
          },
          limit: {
            type: 'number',
            description: 'Max number of events to return (default 50)',
          },
        },
        required: [],
      },
    },
    {
      name: 'read_canvas',
      description:
        'Read the objects on an infinite canvas. Returns object types, positions, and text content.',
      input_schema: {
        type: 'object' as const,
        properties: {
          fileId: { type: 'string', description: 'The file ID of the canvas to read' },
        },
        required: ['fileId'],
      },
    },
    {
      name: 'search_web_captures',
      description:
        'Search captured web pages and browsing context. Returns titles, URLs, excerpts, tags, and analysis results from previously captured web content.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match against capture titles and content',
          },
          limit: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: [],
      },
    },
    {
      name: 'get_realtime_activity',
      description:
        'Query real-time activity data captured every 15 seconds. Returns micro-summaries describing what the user has been doing (browsing, editing, idle) and optionally per-second heartbeat records showing document focus and idle state. Use when the user asks about recent activity or you need detailed context about their work patterns.',
      input_schema: {
        type: 'object' as const,
        properties: {
          lookbackMinutes: {
            type: 'number',
            description: 'How many minutes of history to look back (default 5, max 60)',
          },
          includeHeartbeats: {
            type: 'boolean',
            description:
              'Whether to include per-second heartbeat records (default false). Useful for detailed activity patterns.',
          },
          limit: {
            type: 'number',
            description: 'Max number of micro-summaries to return (default 20)',
          },
        },
        required: [],
      },
    },
    {
      name: 'annotate_document',
      description:
        "Annotate specific text passages in the user's document by marking them with explanatory underlines. Use this when the user asks you to underline, highlight, mark, or annotate important/key/notable parts of their document. Return an array of annotations, each containing the exact text snippet to underline and an explanation of why it is important. The text snippets MUST be exact substrings copied verbatim from the document content — do not paraphrase or summarize.",
      input_schema: {
        type: 'object' as const,
        properties: {
          annotations: {
            type: 'array',
            description: 'Array of text annotations to apply to the document',
            items: {
              type: 'object',
              properties: {
                spanText: {
                  type: 'string',
                  description:
                    'The exact text to underline — must be an exact substring of the document',
                },
                explanation: {
                  type: 'string',
                  description: 'Brief explanation of why this text is important (shown on hover)',
                },
                category: {
                  type: 'string',
                  description: 'Category of annotation',
                  enum: ['important', 'definition', 'conclusion', 'evidence', 'argument'],
                },
              },
              required: ['spanText', 'explanation'],
            },
          },
          summary: {
            type: 'string',
            description: 'Brief summary of what was annotated (shown in chat response)',
          },
        },
        required: ['annotations', 'summary'],
      },
    },
  ]

  // ─── Google Workspace Tools ──────────────────────────────────────
  if (isGWS) {
    base.push(
      {
        name: 'read_google_doc',
        description:
          'Read the content of the current Google Workspace document (Doc, Sheet, or Slides). Returns the latest content snapshot stored from the extension. Use this when you need to read/search the document text.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description:
                'Optional search query — if provided, returns only paragraphs/sections matching the query instead of the full document.',
            },
          },
          required: [],
        },
      },
      {
        name: 'propose_document_edit',
        description:
          'Propose an edit to the Google Document. The edit appears as an inline preview that the user can accept or reject. Always use this tool when the user asks you to modify, add, or change document content.',
        input_schema: {
          type: 'object' as const,
          properties: {
            summary: {
              type: 'string',
              description:
                "One-line description of the edit for the toolbar (e.g. 'Document summary', 'Rewritten introduction')",
            },
            action: {
              type: 'string',
              description:
                'The edit action: "replace" = find and replace text, "insert" = insert new text BEFORE the findText anchor, "append" = add to end of document.',
              enum: ['replace', 'insert', 'append'],
            },
            findText: {
              type: 'string',
              description:
                'An exact verbatim substring from the document to anchor the edit. For "replace": the text to be replaced. For "insert": the exact heading or text BEFORE which new content will be inserted (e.g. findText="Introduction" inserts new content right before the Introduction heading). Must match exactly. Not used for "append".',
            },
            newText: {
              type: 'string',
              description:
                'The new text content to insert, replace with, or append. Use plain text with newlines for paragraphs.',
            },
          },
          required: ['summary', 'action', 'newText'],
        },
      },
      {
        name: 'annotate_google_doc',
        description:
          'REQUIRED tool for analyzing, highlighting, and annotating text in Google Docs. Use this when the user asks you to analyze, highlight, compare, find insights, identify key concepts, rate, or annotate ANY text in their document. You MUST call this tool — do NOT describe findings in text only. Each annotation highlights a specific text span and shows your analysis in an insight card. Provide exact verbatim text snippets from the document as spanText.',
        input_schema: {
          type: 'object' as const,
          properties: {
            annotations: {
              type: 'array',
              description:
                'Array of document annotations — each highlights text and provides analysis',
              items: {
                type: 'object',
                properties: {
                  spanText: {
                    type: 'string',
                    description:
                      'The exact text to highlight — must be a verbatim substring from the document',
                  },
                  insight: {
                    type: 'string',
                    description:
                      'Your analysis, insight, or finding about this text. This is shown in the insight card when the user interacts with the highlight.',
                  },
                  category: {
                    type: 'string',
                    description: 'Category of analysis',
                    enum: [
                      'key-concept',
                      'insight',
                      'strength',
                      'weakness',
                      'comparison',
                      'evidence',
                      'risk',
                      'opportunity',
                      'definition',
                      'action-item',
                      'question',
                    ],
                  },
                  rating: {
                    type: 'number',
                    description:
                      'Optional 1-5 rating for comparative analysis (e.g. feature strength, importance level)',
                  },
                  format: {
                    type: 'string',
                    description:
                      'Optional text formatting to apply to this span in the document. Use "underline" when the user asks to underline text, "bold" for bold, "italic" for italic. When format is provided, the text style is applied directly in Google Docs.',
                    enum: ['underline', 'bold', 'italic'],
                  },
                },
                required: ['spanText', 'insight', 'category'],
              },
            },
            summary: {
              type: 'string',
              description: 'Brief summary of what was annotated',
            },
          },
          required: ['annotations', 'summary'],
        },
      },
      {
        name: 'edit_google_sheet',
        description:
          'Write values to a Google Sheet. Specify a range (e.g. "A1:C3") and a 2D array of values. The edit is queued and applied by the browser extension.',
        input_schema: {
          type: 'object' as const,
          properties: {
            range: {
              type: 'string',
              description: 'A1 notation range (e.g. "Sheet1!A1:C3" or "A1:B5")',
            },
            values: {
              type: 'array',
              description: 'A 2D array of values — each inner array is a row',
              items: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          required: ['range', 'values'],
        },
      }
    )
  }

  // When GWS tools are available, remove the native annotate_document
  // to avoid confusion — annotate_google_doc replaces it for Google Docs
  if (isGWS) {
    return base.filter((t) => t.name !== 'annotate_document')
  }

  return base
}

/**
 * Execute a tool call by name with the given parameters.
 */
export async function executeToolCall(
  toolName: string,
  params: Record<string, unknown>,
  workspaceId: string,
  userId?: string,
  contextObjectType?: string | null,
  contextObjectId?: string | null,
  documentContent?: string | null
): Promise<unknown> {
  switch (toolName) {
    case 'search_files':
      return searchFiles(workspaceId, params['query'] as string, (params['limit'] as number) ?? 10)

    case 'read_file':
      return readFile(params['fileId'] as string)

    case 'read_file_section':
      return readFileSection(
        params['fileId'] as string,
        params['sectionIndex'] as number | undefined,
        params['sectionTitle'] as string | undefined
      )

    case 'create_file':
      return createFile(
        workspaceId,
        params['name'] as string,
        params['content'] as string,
        (params['fileType'] as string) ?? 'note',
        params['parentFolderId'] as string | undefined,
        userId
      )

    case 'list_files':
      return listFiles(workspaceId, params['parentFolderId'] as string | undefined)

    case 'get_timeline_summary':
      return getTimelineSummary(
        workspaceId,
        Math.min((params['hours'] as number) ?? 24, 168),
        (params['limit'] as number) ?? 50
      )

    case 'read_canvas':
      return readCanvas(params['fileId'] as string)

    case 'search_web_captures':
      return searchWebCaptures(
        workspaceId,
        params['query'] as string | undefined,
        (params['limit'] as number) ?? 10
      )

    case 'get_realtime_activity':
      return getRealtimeActivity(
        workspaceId,
        userId ?? '',
        (params['lookbackMinutes'] as number) ?? 5,
        (params['includeHeartbeats'] as boolean) ?? false,
        (params['limit'] as number) ?? 20
      )

    case 'annotate_document': {
      // Passthrough — structured annotations are returned directly to the frontend
      const rawAnnotations =
        (params['annotations'] as Array<{
          spanText: string
          explanation: string
          category?: string
        }>) ?? []
      return {
        annotations: rawAnnotations.map((a, i) => ({
          id: `ann-${Date.now()}-${i}`,
          spanText: a.spanText,
          explanation: a.explanation,
          category: a.category ?? 'important',
        })),
        summary: (params['summary'] as string) ?? '',
        applied: true,
      }
    }

    // ─── Google Workspace Tools ──────────────────────────────────
    case 'read_google_doc':
      return readGoogleDoc(
        contextObjectId ?? '',
        workspaceId,
        params['query'] as string | undefined,
        documentContent
      )

    case 'propose_document_edit':
    case 'edit_google_doc': {
      const editAction = {
        type: 'edit_doc',
        action: params['action'] as string,
        findText: params['findText'] as string | undefined,
        newText: params['newText'] as string,
        summary: params['summary'] as string | undefined,
      }
      // If we have a tracked document, queue via DB; otherwise return the edit
      // data directly so the SSE handler can emit draft_preview for the extension
      if (contextObjectId) {
        return queueGWSAction(contextObjectId, workspaceId, editAction)
      }
      // Direct mode — extension will handle via draft_preview SSE event
      return {
        directEdit: true,
        _actionData: editAction,
        message: `Draft ready: ${editAction.action} "${(editAction.newText as string)?.slice(0, 80)}..."`,
      }
    }

    case 'annotate_google_doc': {
      const gwsAnnotations =
        (params['annotations'] as Array<{
          spanText: string
          insight?: string
          explanation?: string
          category?: string
          rating?: number
          format?: 'underline' | 'bold' | 'italic'
        }>) ?? []
      return {
        annotations: gwsAnnotations.map((a, i) => ({
          id: `gws-ann-${Date.now()}-${i}`,
          spanText: a.spanText,
          insight: a.insight || a.explanation || '',
          category: a.category ?? 'key-concept',
          rating: a.rating ?? null,
          ...(a.format ? { format: a.format } : {}),
        })),
        summary: (params['summary'] as string) ?? '',
        applied: true,
        source: 'google_workspace',
      }
    }

    case 'edit_google_sheet':
      return queueGWSAction(contextObjectId ?? '', workspaceId, {
        type: 'edit_sheet',
        range: params['range'] as string,
        values: params['values'] as string[][],
      })

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}

// ─── Tool Implementations ──────────────────────────────────────────

async function searchFiles(workspaceId: string, query: string, limit: number) {
  const results = await db
    .select({
      id: files.id,
      name: files.name,
      type: files.type,
      mimeType: files.mimeType,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .where(
      and(
        eq(files.workspaceId, workspaceId),
        ilike(files.name, `%${query}%`),
        isNull(files.deletedAt)
      )
    )
    .orderBy(desc(files.updatedAt))
    .limit(limit)

  return {
    results,
    total: results.length,
    query,
  }
}

async function readFile(fileId: string) {
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1)

  if (!file) {
    return { error: 'File not found' }
  }

  // Extract real document content via Yjs decoder
  const outline = extractFileContent({
    id: file.id,
    workspaceId: file.workspaceId,
    metadata: file.metadata as Record<string, unknown> | null,
  })

  if (outline) {
    const truncated = outline.fullText.length > CONTENT_MAX_CHARS
    return {
      id: file.id,
      name: file.name,
      type: file.type,
      mimeType: file.mimeType,
      version: file.version,
      updatedAt: file.updatedAt,
      content: truncated
        ? outline.fullText.slice(0, CONTENT_MAX_CHARS) +
          '\n\n[... truncated — use read_file_section to read specific sections]'
        : outline.fullText,
      outline: {
        sections: outline.sections.map((s, i) => ({
          index: i,
          title: s.title,
          headingLevel: s.headingLevel,
          wordCount: s.wordCount,
        })),
        totalWordCount: outline.totalWordCount,
        totalSections: outline.sections.length,
        headingHierarchy: outline.headingHierarchy,
      },
      truncated,
    }
  }

  // No extractable content (binary file, image, etc.)
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    mimeType: file.mimeType,
    version: file.version,
    updatedAt: file.updatedAt,
    content: null,
  }
}

async function readFileSection(fileId: string, sectionIndex?: number, sectionTitle?: string) {
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1)

  if (!file) {
    return { error: 'File not found' }
  }

  const outline = extractFileContent({
    id: file.id,
    workspaceId: file.workspaceId,
    metadata: file.metadata as Record<string, unknown> | null,
  })

  if (!outline || outline.sections.length === 0) {
    return { error: 'No sections found in document' }
  }

  // Find the target section
  let section = null
  let idx = -1

  if (typeof sectionIndex === 'number') {
    if (sectionIndex >= 0 && sectionIndex < outline.sections.length) {
      section = outline.sections[sectionIndex]
      idx = sectionIndex
    }
  } else if (typeof sectionTitle === 'string') {
    const lower = sectionTitle.toLowerCase()
    idx = outline.sections.findIndex((s) => s.title.toLowerCase().includes(lower))
    if (idx >= 0) section = outline.sections[idx]
  }

  if (!section) {
    return {
      error: 'Section not found',
      availableSections: outline.sections.map((s, i) => ({
        index: i,
        title: s.title,
        headingLevel: s.headingLevel,
        wordCount: s.wordCount,
      })),
    }
  }

  const truncated = section.textContent.length > SECTION_MAX_CHARS
  return {
    fileId: file.id,
    fileName: file.name,
    sectionIndex: idx,
    sectionTitle: section.title,
    headingLevel: section.headingLevel,
    wordCount: section.wordCount,
    content: truncated
      ? section.textContent.slice(0, SECTION_MAX_CHARS) + '\n\n[... section truncated]'
      : section.textContent,
    truncated,
    totalSections: outline.sections.length,
  }
}

async function createFile(
  workspaceId: string,
  name: string,
  content: string,
  fileType: string,
  parentFolderId?: string,
  userId?: string
) {
  const mimeType = fileType === 'document' ? 'application/vnd.workspace.document' : 'text/markdown'
  const extension = fileType === 'document' ? '.doc' : '.md'

  const [newFile] = await db
    .insert(files)
    .values({
      workspaceId,
      name: name.endsWith(extension) ? name : `${name}${extension}`,
      type: 'file',
      mimeType,
      parentFolderId: parentFolderId ?? null,
      metadata: { content, editorType: fileType === 'document' ? 'document' : 'note' },
      createdBy: userId || DEV_USER.id,
      version: 1,
    })
    .returning()

  if (!newFile) {
    return { error: 'Failed to create file' }
  }

  return {
    fileId: newFile.id,
    name: newFile.name,
    created: true,
  }
}

async function listFiles(workspaceId: string, parentFolderId?: string) {
  const conditions = [eq(files.workspaceId, workspaceId), isNull(files.deletedAt)]
  if (parentFolderId) {
    conditions.push(eq(files.parentFolderId, parentFolderId))
  } else {
    conditions.push(isNull(files.parentFolderId))
  }

  const results = await db
    .select({
      id: files.id,
      name: files.name,
      type: files.type,
      mimeType: files.mimeType,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .where(and(...conditions))
    .orderBy(desc(files.updatedAt))
    .limit(50)

  return { files: results, count: results.length }
}

async function getTimelineSummary(workspaceId: string, hours: number, limit: number) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

  // Get recent thread events with thread context
  const events = await db
    .select({
      time: threadEvents.time,
      label: threadEvents.label,
      type: threadEvents.type,
      magnitude: threadEvents.magnitude,
      keyChange: threadEvents.keyChange,
      threadName: threads.name,
      threadType: threads.type,
    })
    .from(threadEvents)
    .innerJoin(threads, eq(threadEvents.threadId, threads.id))
    .where(and(eq(threads.workspaceId, workspaceId), gte(threadEvents.time, cutoff)))
    .orderBy(desc(threadEvents.time))
    .limit(limit)

  // Summarize by type
  const byType: Record<string, number> = {}
  const keyChanges: string[] = []
  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1
    if (e.keyChange) keyChanges.push(e.label)
  }

  return {
    events: events.map((e) => ({
      time: e.time,
      label: e.label,
      type: e.type,
      magnitude: e.magnitude,
      thread: e.threadName,
    })),
    summary: {
      totalEvents: events.length,
      byType,
      keyChanges,
      period: { from: cutoff.toISOString(), to: new Date().toISOString() },
    },
  }
}

async function readCanvas(fileId: string) {
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1)

  if (!file) {
    return { error: 'Canvas file not found' }
  }

  const canvasState = (file.metadata as Record<string, unknown>)?.canvasState as
    | { objects: Record<string, unknown> }
    | undefined

  if (!canvasState?.objects) {
    return { canvasId: file.id, name: file.name, objects: [], objectCount: 0 }
  }

  const objects = Object.values(canvasState.objects).map((obj: unknown) => {
    const o = obj as Record<string, unknown>
    const data = (o.data as Record<string, unknown>) ?? {}

    // Base object info
    const result: Record<string, unknown> = {
      id: o.id,
      type: o.type,
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height,
      text: data.text ?? data.plainText ?? null,
    }

    // Embed/PDF: include extracted text, file name, page count
    if (o.type === 'embed') {
      if (data.fileName) result.fileName = data.fileName
      if (data.mimeType) result.mimeType = data.mimeType
      if (data.pageCount) result.pageCount = data.pageCount
      if (data.extractedText) {
        // Cap at 8K chars per PDF to keep tool response manageable
        const extracted = data.extractedText as string
        result.extractedText =
          extracted.length > 8000 ? extracted.slice(0, 8000) + '... [truncated]' : extracted
      }
    }

    return result
  })

  return {
    canvasId: file.id,
    name: file.name,
    objects,
    objectCount: objects.length,
  }
}

async function getRealtimeActivity(
  workspaceId: string,
  targetUserId: string,
  lookbackMinutes: number,
  includeHeartbeats: boolean,
  limit: number
) {
  const clampedLookback = Math.min(Math.max(lookbackMinutes, 1), 60)
  const clampedLimit = Math.min(Math.max(limit, 1), 50)

  // Query processed intents (micro-summaries from Gemini's 15s processing)
  let microSummaries: Array<{
    timestamp: string
    user_action: string
    user_intent: string
    summary_text: string
    confidence: number
    tags: string[]
  }> = []

  try {
    const conditions = [
      'workspace_id = {workspaceId:UUID}',
      'timestamp >= now() - INTERVAL {lookback:UInt32} MINUTE',
    ]
    const queryParams: Record<string, unknown> = {
      workspaceId,
      lookback: clampedLookback,
      limit: clampedLimit,
    }

    if (targetUserId) {
      conditions.push('user_id = {userId:UUID}')
      queryParams.userId = targetUserId
    }

    const result = await clickhouse.query({
      query: `
        SELECT timestamp, user_action, user_intent, summary_text, confidence, tags
        FROM processed_intents
        WHERE ${conditions.join(' AND ')}
        ORDER BY timestamp DESC
        LIMIT {limit:UInt32}
      `,
      query_params: queryParams,
      format: 'JSONEachRow',
    })

    microSummaries = await result.json()
    microSummaries.reverse() // chronological
  } catch (err) {
    console.warn('[Tool:get_realtime_activity] Micro-summary query failed:', (err as Error).message)
  }

  // Optionally query heartbeats for detailed activity patterns
  let heartbeats: Array<{
    timestamp: string
    is_idle: number
    active_document_name: string
    active_document_type: string
    active_page: string
  }> = []

  if (includeHeartbeats) {
    try {
      const hbConditions = [
        'workspace_id = {workspaceId:UUID}',
        'timestamp >= now() - INTERVAL {lookback:UInt32} MINUTE',
      ]
      const hbParams: Record<string, unknown> = {
        workspaceId,
        lookback: clampedLookback,
      }

      if (targetUserId) {
        hbConditions.push('user_id = {userId:UUID}')
        hbParams.userId = targetUserId
      }

      const hbResult = await clickhouse.query({
        query: `
          SELECT timestamp, is_idle, active_document_name, active_document_type, active_page
          FROM timeline_heartbeats
          WHERE ${hbConditions.join(' AND ')}
          ORDER BY timestamp DESC
          LIMIT 100
        `,
        query_params: hbParams,
        format: 'JSONEachRow',
      })

      heartbeats = await hbResult.json()
      heartbeats.reverse() // chronological
    } catch (err) {
      console.warn('[Tool:get_realtime_activity] Heartbeat query failed:', (err as Error).message)
    }
  }

  return {
    microSummaries: microSummaries.map((s) => ({
      timestamp: s.timestamp,
      action: s.user_action,
      intent: s.user_intent,
      summary: s.summary_text,
      confidence: s.confidence,
      tags: s.tags,
    })),
    summaryCount: microSummaries.length,
    heartbeats: includeHeartbeats
      ? heartbeats.map((h) => ({
          timestamp: h.timestamp,
          idle: !!h.is_idle,
          document: h.active_document_name || null,
          documentType: h.active_document_type || null,
          page: h.active_page,
        }))
      : undefined,
    heartbeatCount: includeHeartbeats ? heartbeats.length : undefined,
    lookbackMinutes: clampedLookback,
  }
}

async function searchWebCaptures(workspaceId: string, query: string | undefined, limit: number) {
  const conditions = [eq(webCaptures.workspaceId, workspaceId)]

  if (query) {
    conditions.push(ilike(webCaptures.title, `%${query}%`))
  }

  const captures = await db
    .select({
      id: webCaptures.id,
      title: webCaptures.title,
      sourceUrl: webCaptures.sourceUrl,
      content: webCaptures.content,
      tags: webCaptures.tags,
      analyzed: webCaptures.analyzed,
      analysisResult: webCaptures.analysisResult,
      createdAt: webCaptures.createdAt,
    })
    .from(webCaptures)
    .where(and(...conditions))
    .orderBy(desc(webCaptures.createdAt))
    .limit(limit)

  return {
    captures: captures.map((c) => ({
      id: c.id,
      title: c.title,
      sourceUrl: c.sourceUrl,
      excerpt: c.content?.slice(0, 500) ?? '',
      tags: c.tags,
      analysis: c.analyzed ? c.analysisResult : null,
      capturedAt: c.createdAt,
    })),
    count: captures.length,
  }
}

// ─── Google Workspace Tool Implementations ──────────────────────────

/**
 * Read the content snapshot of a Google Workspace document.
 * Optionally filter to paragraphs matching a query string.
 */
async function readGoogleDoc(
  contextObjectId: string,
  workspaceId: string,
  query?: string,
  fallbackContent?: string | null
) {
  // Try to read from tracked document first
  if (contextObjectId) {
    const [doc] = await db
      .select()
      .from(externalDocuments)
      .where(
        and(
          eq(externalDocuments.id, contextObjectId),
          eq(externalDocuments.workspaceId, workspaceId)
        )
      )
      .limit(1)

    if (doc) {
      const metadata = (doc.metadata || {}) as Record<string, unknown>
      const contentSnapshot = (metadata['lastContentSnapshot'] as string) ?? ''

      if (contentSnapshot) {
        if (query) {
          const lowerQuery = query.toLowerCase()
          const paragraphs = contentSnapshot.split('\n')
          const matches = paragraphs.filter((p) => p.toLowerCase().includes(lowerQuery))
          return {
            id: doc.id,
            title: doc.title,
            docType: doc.docType,
            query,
            matchingParagraphs: matches.slice(0, 50),
            matchCount: matches.length,
            totalParagraphs: paragraphs.length,
          }
        }
        const truncated = contentSnapshot.length > CONTENT_MAX_CHARS
        return {
          id: doc.id,
          title: doc.title,
          docType: doc.docType,
          content: truncated
            ? contentSnapshot.slice(0, CONTENT_MAX_CHARS) + '\n\n[... document truncated]'
            : contentSnapshot,
          truncated,
          lastSyncRevision: doc.lastSyncRevision,
          updatedAt: doc.updatedAt,
        }
      }
    }
  }

  // Fallback: use document content sent inline from the extension
  if (fallbackContent) {
    const contentSnapshot = fallbackContent
    if (query) {
      const lowerQuery = query.toLowerCase()
      const paragraphs = contentSnapshot.split('\n')
      const matches = paragraphs.filter((p) => p.toLowerCase().includes(lowerQuery))
      return {
        title: 'Current Document',
        docType: 'document',
        query,
        matchingParagraphs: matches.slice(0, 50),
        matchCount: matches.length,
        totalParagraphs: paragraphs.length,
        source: 'inline_content',
      }
    }
    const truncated = contentSnapshot.length > CONTENT_MAX_CHARS
    return {
      title: 'Current Document',
      docType: 'document',
      content: truncated
        ? contentSnapshot.slice(0, CONTENT_MAX_CHARS) + '\n\n[... document truncated]'
        : contentSnapshot,
      truncated,
      source: 'inline_content',
    }
  }

  return { error: 'No document content available. Enable tracking or open a document.' }
}

/**
 * Queue an action for the GWS browser extension to execute.
 * The extension polls `addon-actions` and picks up pending actions.
 */
async function queueGWSAction(
  contextObjectId: string,
  workspaceId: string,
  action: Record<string, unknown>
): Promise<unknown> {
  if (!contextObjectId) {
    return { error: 'No Google Workspace document context available' }
  }

  const [doc] = await db
    .select()
    .from(externalDocuments)
    .where(
      and(eq(externalDocuments.id, contextObjectId), eq(externalDocuments.workspaceId, workspaceId))
    )
    .limit(1)

  if (!doc) {
    return { error: 'Google Workspace document not found' }
  }

  // Store the structured action in metadata for the extension to pick up
  const existingMeta = (doc.metadata || {}) as Record<string, unknown>
  const pendingActions =
    (existingMeta['pendingActions'] as Record<string, unknown>[] | undefined) ?? []
  const actionEntry = {
    id: `action-${Date.now()}`,
    ...action,
    createdAt: new Date().toISOString(),
    status: 'pending',
  }
  pendingActions.push(actionEntry)

  await db
    .update(externalDocuments)
    .set({
      metadata: {
        ...existingMeta,
        pendingActions,
        pendingAction: action.type as string, // backwards compat with simple polling
        pendingActionTs: new Date().toISOString(),
      } as (typeof externalDocuments.$inferInsert)['metadata'],
      updatedAt: new Date(),
    })
    .where(eq(externalDocuments.id, doc.id))

  const actionLabels: Record<string, string> = {
    edit_doc: `Queued document edit: ${action.action} "${(action.newText as string)?.slice(0, 80)}..."`,
    edit_sheet: `Queued sheet edit: range ${action.range}`,
  }

  return {
    queued: true,
    actionId: actionEntry.id,
    message:
      actionLabels[action.type as string] ?? 'Action queued for the browser extension to execute.',
    documentTitle: doc.title,
    // Pass through action data so SSE can emit draft_preview for ghost drafts
    _actionData: action,
  }
}
