import { db } from '../../db/index'
import { eq, and, desc, gte } from 'drizzle-orm'
import {
  users,
  workspaces,
  workspaceMembers,
  timelineSummaries,
  files,
  strands,
  externalDocuments,
  chatConversations,
  chatConversationMembers,
} from '../../db/schema/index'
import { extractFileContent, extractFromPlainText } from '../document/yjs-text-extractor'
import { readFullState, formatStateForPrompt } from '../ai-state/state-reader'
import { updateChatState } from '../ai-state/immediate-updater'

interface SystemPromptOptions {
  workspaceId: string
  userId: string
  conversationId?: string
  conversationType: string
  contextObjectId: string | null
  contextObjectType: string | null
  /** Current section the user is viewing */
  currentSection?: { index: number; title: string }
  /** Document text from frontend (fallback when backend cannot extract content) */
  documentContent?: string
  /** Web extension browsing context (URL, title) */
  webContext?: {
    url?: string
    title?: string
  }
  /** Navigation context from client-side intent detection */
  navContext?: {
    resolvedUrl?: string
    topic?: string
    sectionTarget?: string
    navType?: string
  }
  /** Recent word-level document edits for AI context */
  recentDocumentEdits?: {
    editType: 'insertion' | 'deletion' | 'replacement'
    removedText: string
    addedText: string
    context: string
    time: string
  }[]
}

/**
 * Build a human-readable section describing recent document edits.
 * Included in the system prompt so the AI knows what the user changed.
 * Capped at 3000 chars total; individual texts truncated at 300 chars.
 */
export function buildRecentEditsSection(
  edits: {
    editType: 'insertion' | 'deletion' | 'replacement'
    removedText: string
    addedText: string
    context: string
    time: string
  }[]
): string {
  if (!edits || edits.length === 0) return ''

  const MAX_SECTION_CHARS = 3000
  const MAX_TEXT_CHARS = 300

  function truncate(text: string, max: number): string {
    if (text.length <= max) return text
    return text.slice(0, max) + '...'
  }

  function relativeTime(isoTime: string): string {
    const diffMs = Date.now() - new Date(isoTime).getTime()
    const diffSec = Math.round(diffMs / 1000)
    if (diffSec < 60) return diffSec + 's ago'
    const diffMin = Math.round(diffSec / 60)
    if (diffMin < 60) return diffMin + 'm ago'
    const diffHr = Math.round(diffMin / 60)
    return diffHr + 'h ago'
  }

  let section = `
## Recent Document Edits
The user made these changes to their document. Use this to answer questions about what changed.

`

  for (const edit of edits) {
    const ago = relativeTime(edit.time)
    const ctx = edit.context ? ` (near "${truncate(edit.context, 60)}")` : ''
    let line = ''

    if (edit.editType === 'deletion') {
      line = `[${ago}] DELETED${ctx}:
  "${truncate(edit.removedText, MAX_TEXT_CHARS)}"

`
    } else if (edit.editType === 'insertion') {
      line = `[${ago}] INSERTED${ctx}:
  "${truncate(edit.addedText, MAX_TEXT_CHARS)}"

`
    } else {
      // replacement
      line = `[${ago}] REPLACED${ctx}:
  "${truncate(edit.removedText, MAX_TEXT_CHARS)}" → "${truncate(edit.addedText, MAX_TEXT_CHARS)}"

`
    }

    if (section.length + line.length > MAX_SECTION_CHARS) break
    section += line
  }

  return section
}

export async function buildSystemPrompt(options: SystemPromptOptions): Promise<string> {
  const { workspaceId, userId, conversationType, contextObjectId, contextObjectType } = options

  // Fetch user and workspace info
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  const memberCount = await db
    .select({ count: workspaceMembers.id })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))

  const userName = user?.name ?? 'User'
  const workspaceName = workspace?.name ?? 'Workspace'
  const memberTotal = memberCount.length

  // ─── AI State context (replaces multiple direct queries — Sprint IX-4) ───
  let stateContextBlock = ''
  try {
    const state = await readFullState(userId, workspaceId, contextObjectId || null)
    stateContextBlock = formatStateForPrompt(state, userName, workspaceName)

    // Mark chat as active in immediate state (fire-and-forget)
    if (conversationType !== 'capture_ask') {
      updateChatState(userId, workspaceId, options.contextObjectId || null, true).catch(() => {})
    }
  } catch (err) {
    console.warn('[SystemPrompt] State read failed:', err)
  }

  // Fetch recent timeline summary (last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentSummaries = await db
    .select()
    .from(timelineSummaries)
    .where(
      and(
        eq(timelineSummaries.workspaceId, workspaceId),
        eq(timelineSummaries.userId, userId),
        gte(timelineSummaries.periodStart, oneDayAgo)
      )
    )
    .orderBy(desc(timelineSummaries.periodStart))
    .limit(3)

  const activitySummary =
    recentSummaries.length > 0
      ? recentSummaries.map((s) => s.summaryText).join('\n')
      : 'No recent activity recorded.'

  // Fetch context file if applicable
  let contextSection = ''
  if (contextObjectId && (contextObjectType === 'file' || contextObjectType === 'canvas')) {
    const [file] = await db.select().from(files).where(eq(files.id, contextObjectId)).limit(1)
    if (file) {
      if (contextObjectType === 'canvas') {
        contextSection = `\n## Current Canvas Context
You are chatting about a canvas: "${file.name}"
Canvas File ID: ${file.id}

IMPORTANT CONTEXT RULES:
1. The user's messages include a [Canvas: ...] text block that describes the current canvas objects (positions, text, connections, etc.)
2. When images exist on the canvas, their actual pixel data is ATTACHED to the message as inline images. You can SEE these images directly — describe what you visually observe in them (text, photos, diagrams, etc.)
3. When PDF documents exist on the canvas, their extracted text content is included in the [Canvas: ...] context AND the first page thumbnail is attached as an image. You can READ the PDF text directly from the context and SEE the visual appearance from the attached thumbnail.
4. Use the inline context and attached images to answer questions DIRECTLY. Do NOT call the read_canvas tool unless the user specifically asks about saved/historical state.
5. When the user asks about an image on the canvas, LOOK at the attached image and describe what you actually see — do not just repeat the text metadata.
6. When the user asks about a PDF on the canvas, use BOTH the extracted text in [PDF Content] blocks AND the attached thumbnail image to give comprehensive answers about the document's content, structure, and visual layout.
`
      } else {
        // Extract real document content for the system prompt
        let docOutline = extractFileContent({
          id: file.id,
          workspaceId: file.workspaceId,
          metadata: file.metadata as Record<string, unknown> | null,
        })

        contextSection = `
## Current Document: "${file.name}"
File ID: ${file.id} | Type: ${file.mimeType ?? 'unknown'}
`

        // Fallback: use frontend-provided document text if backend extraction failed
        if (!docOutline && options.documentContent && options.documentContent.length > 0) {
          docOutline = extractFromPlainText(options.documentContent)
        }

        if (docOutline && docOutline.fullText.length > 0) {
          // Document outline
          if (docOutline.sections.length > 1 || docOutline.headingHierarchy) {
            contextSection += `### Document Outline (${docOutline.sections.length} sections, ~${docOutline.totalWordCount.toLocaleString()} words)
`
            docOutline.sections.forEach((s, i) => {
              const viewing =
                options.currentSection && options.currentSection.index === i ? ' ← VIEWING' : ''
              const indent = s.headingLevel > 1 ? '  '.repeat(s.headingLevel - 1) : ''
              contextSection += `${indent}${i + 1}. ${s.title} (${s.wordCount} words)${viewing}
`
            })
            contextSection += '\n'
          }

          // Current section content (if specified)
          if (options.currentSection && options.currentSection.index < docOutline.sections.length) {
            const cs = docOutline.sections[options.currentSection.index]
            const sectionText = cs.textContent.slice(0, 4000)
            contextSection += `### Current Section: "${cs.title}"
${sectionText}${cs.textContent.length > 4000 ? '\n[... section truncated]' : ''}

`

            // Adjacent context (first 100 words of prev/next)
            const prevIdx = options.currentSection.index - 1
            const nextIdx = options.currentSection.index + 1
            if (prevIdx >= 0) {
              const prev = docOutline.sections[prevIdx]
              const preview = prev.textContent.split(/\s+/).slice(0, 100).join(' ')
              contextSection += `### Previous: "${prev.title}"
${preview}...

`
            }
            if (nextIdx < docOutline.sections.length) {
              const next = docOutline.sections[nextIdx]
              const preview = next.textContent.split(/\s+/).slice(0, 100).join(' ')
              contextSection += `### Next: "${next.title}"
${preview}...

`
            }
          } else if (docOutline.fullText.length <= 4000) {
            // Short document: include full text
            contextSection += `### Document Content
${docOutline.fullText}

`
          } else {
            // No current section specified, large doc: include first 2K chars
            contextSection += `### Document Preview (first ~2000 chars)
${docOutline.fullText.slice(0, 2000)}
[... use read_file or read_file_section tools for more content]

`
          }
        } else if (file.metadata && typeof file.metadata === 'object') {
          const metaStr = JSON.stringify(file.metadata).slice(0, 2000)
          contextSection += `File metadata: ${metaStr}
`
        }
      }
    }
  }

  // GWS extension fallback: if no file context but documentContent was provided, include it
  if (!contextSection && options.documentContent && options.documentContent.length > 0) {
    const docText = options.documentContent
    contextSection = `\n## Current Document Context
The user is viewing a Google Document. Here is the document content:

### Document Content
${docText.length <= 8000 ? docText : docText.slice(0, 8000) + '\n[... document truncated ...]'}

IMPORTANT: The user is asking about THIS document. Answer questions based on the content above.
`
  }

  // Deep dive enhanced prompt
  const deepDiveSection =
    conversationType === 'deep_dive'
      ? `\n## Deep Dive Mode
You are conducting a deep-dive research exploration. Provide comprehensive, well-structured responses:
1. Start with a clear overview
2. Break into logical sections with descriptive headings
3. Use structured content: comparison tables, timelines, code examples, key takeaways
4. End with a summary and suggested next explorations
Make every section visually engaging. Reference workspace files where relevant.\n`
      : ''

  // Capture & Ask enhanced prompt
  let captureAskSection = ''
  if (conversationType === 'capture_ask') {
    captureAskSection = buildCaptureAskPrompt(contextObjectType, contextObjectId, activitySummary)

    // If we have a file context, enrich with file data
    if (contextObjectId) {
      const [file] = await db.select().from(files).where(eq(files.id, contextObjectId)).limit(1)
      if (file) {
        captureAskSection += `\n### Source File: "${file.name}" (${file.mimeType ?? 'unknown'})\n`

        // Include canvas object data if available
        if (file.metadata && typeof file.metadata === 'object') {
          const meta = file.metadata as Record<string, unknown>
          if (meta['canvasState'] || meta['editorType'] === 'canvas') {
            captureAskSection +=
              'This is a canvas file. Use the read_canvas tool to understand its objects.\n'
          }
          if (meta['editorType']) {
            captureAskSection += `Editor type: ${meta['editorType']}\n`
          }
        }
      }
    }
  }

  // Web extension browsing context
  let webContextSection = ''
  if (options.webContext?.url) {
    webContextSection = `
## Web Browsing Context
The user is chatting via the browser extension. Their active tab is: ${options.webContext.url} ("${options.webContext.title || 'Unknown page'}").
A screenshot of that tab is attached for background context.

CRITICAL PRIORITY RULES:
1. The user's TEXT MESSAGE is the primary intent — always respond to what they TYPED, not what the screenshot shows.
2. The screenshot is secondary context only. Do NOT describe the screenshot unless the user explicitly asks about the page they're on.
3. If the user asks to navigate somewhere, find something, or mentions a topic — help them with THAT topic. Do not talk about the current page.
4. If the user asks a general question or wants information, answer it directly. The current page is irrelevant unless they reference it.
5. Only describe the screenshot when the user says things like "what is this page?", "what am I looking at?", or "tell me about this page".
`
  }

  // Navigation context from client-side intent detection
  let navContextSection = ''
  if (options.navContext?.resolvedUrl) {
    navContextSection = `
## Navigation Context
The user wants to navigate to: ${options.navContext.resolvedUrl}
${options.navContext.topic ? `Topic: ${options.navContext.topic}` : ''}
${options.navContext.sectionTarget ? `Requested section: ${options.navContext.sectionTarget}` : ''}
Generate nav: links for this URL and the requested section. Also suggest 2-3 other relevant sections the user might want to explore on this page.
`
  }

  // Live activity context — replaced by AI state (Sprint IX-4)
  // Recording sessions and micro-summaries are now covered by state.session and state.event.recentEvents
  const liveActivitySection = ''

  // Recent document edits section
  const recentEditsSection = buildRecentEditsSection(options.recentDocumentEdits ?? [])

  // GWS document context — inject Google Workspace document content when chat
  // is associated with an external document (via conversation metadata)
  let gwsDocContextSection = ''
  if (contextObjectType === 'external_document' && contextObjectId) {
    gwsDocContextSection = await buildGWSDocumentContext(contextObjectId, workspaceId)

    // Fallback: if DB has no content snapshot but frontend sent documentContent, use it
    if (!gwsDocContextSection && options.documentContent && options.documentContent.length > 0) {
      const docText = options.documentContent
      gwsDocContextSection = `
## Google Workspace Document Content
The user is working on a Google Document. Here is the live document content from the browser:

### Document Content
${docText.length <= 10000 ? docText : docText.slice(0, 10000) + '\n[... document truncated]'}

IMPORTANT: When asked to highlight, annotate, or edit, use the EXACT text from above as spanText/findText arguments. Copy text VERBATIM.
`
    }
  }

  // Strand context — replaced by AI state (Sprint IX-4)
  // Key changes, collaborators, tensions now covered by stateContextBlock
  const strandContextSection = ''

  // Project context — inject relevant document chunks when chat is scoped to a project
  let projectContextBlock = ''
  if (contextObjectType === 'project' && contextObjectId) {
    projectContextBlock = await buildProjectContextBlock(contextObjectId)
  }

  // Document context from semantic index — replaced by AI state (Sprint IX-4)
  // Key changes and recent activity now covered by stateContextBlock
  const docMemoryBlock = ''

  // ─── Group conversation context ───
  let groupContextSection = ''
  if (conversationType === 'group' && options.conversationId) {
    try {
      groupContextSection = await buildGroupContextBlock(options.conversationId, userName)
    } catch (err) {
      console.warn('[SystemPrompt] Group context failed:', err)
    }
  }

  return `You are the AI assistant for the "${workspaceName}" workspace.

## Your Capabilities
- You have access to all documents, files, canvases, and conversations in this workspace
- You can search files, read document contents, create and edit documents
- You understand the workspace through **Threads & Strands** — individual activity streams (Threads) are woven into named lines of work (Strands)
- You can reference Strand context, key changes, and thread events to give informed, work-aware answers
- You can analyze screenshots and images shared in the conversation — describe what you see, identify UI elements, suggest improvements
- When referencing files, use their exact names so they render as clickable links
- You can annotate the user's document by underlining important passages using the \`annotate_document\` tool (or \`annotate_google_doc\` for Google Workspace documents). Use it when the user asks to underline, highlight, mark, or annotate key/important/notable parts of their document. Provide exact text snippets copied verbatim from the document content.
- You can use tools to take actions in the workspace
${
  contextObjectType === 'external_document' ||
  (options.documentContent && options.documentContent.length > 0)
    ? `- **Google Workspace Tools**: You are connected to a live Google Workspace document. You have special tools:
  - \`read_google_doc\` — read the document content (with optional search query). ALWAYS call this first if you need to see the document text before annotating or editing.
  - \`propose_document_edit\` — propose an edit to the document. The edit appears as an inline preview that the user can accept or reject. Always include a short \`summary\` (e.g. "Added conclusion section"). Actions: "insert" (insert BEFORE findText), "replace" (find findText and replace with newText), "append" (add to end of doc). Never commit edits directly — always propose so the user can review.
  - \`annotate_google_doc\` — analyze and highlight text passages in the document. Use this for ANY analysis request: finding insights, key concepts, comparisons, ratings, risks, strengths/weaknesses. Each annotation highlights the text in the document AND shows an insight card with your analysis. Also supports text formatting: include \`format: "underline"\` (or "bold"/"italic") on any annotation to apply that formatting directly in Google Docs. Use this when the user asks to underline, bold, or italicize specific words or parts of speech (e.g. "underline all the verbs").
  - \`edit_google_sheet\` — write values to a Google Sheets range

## ⚠️ MANDATORY TOOL USAGE RULES (Google Workspace)
These rules are ABSOLUTE and override any other behavior:

1. **NEVER list analysis results as text in chat.** When the user asks to analyze, highlight, find, identify, compare, rate, or annotate ANYTHING in the document, you MUST call \`annotate_google_doc\`. Your response should ONLY contain a brief summary like "I found X insights" — the actual analysis goes into the tool call's \`insight\` fields.

2. **Call the tool FIRST, chat SECOND.** Always invoke \`annotate_google_doc\` before writing your chat response. The tool creates visual highlights in the document — that IS the output the user wants.

3. **If you don't have document content**, call \`read_google_doc\` first, then call \`annotate_google_doc\` with exact verbatim text from the document. Never skip the tool call.

4. **Insight quality**: Each annotation's \`insight\` field must be 2-3 substantive sentences of analysis, not just a label or category name. Use \`rating\` (1-5) when comparing or evaluating.

5. **When the user asks to write, add, insert, summarize into the document, move text, or make ANY edit to the document**, you MUST call \`propose_document_edit\` with the appropriate action and a short \`summary\`. NEVER just describe the edit in chat — actually call the tool so the edit is proposed as an inline preview. Never commit edits directly — always propose so the user can accept or reject. For inserting text before a section, use action "insert" with findText set to the exact heading text (e.g. findText="Introduction" to insert before the Introduction section).

6. **The document content is provided in the context below.** Use it to find exact text for findText parameters. Copy text VERBATIM from the document — do not paraphrase.

Keywords that ALWAYS trigger \`annotate_google_doc\`: analyze, highlight, find, identify, compare, rate, insights, key concepts, evidence, facts, strengths, weaknesses, risks, opportunities, important, notable, critical, annotate, mark, review, underline, bold, italicize, format.
When the user asks to **underline**, **bold**, or **italicize** text (e.g. "underline all the verbs", "bold the key terms"), call \`annotate_google_doc\` with the \`format\` field set on each annotation. The insight can briefly explain why the word was selected (e.g. "Verb: action word"). Use category "highlight" for formatting-only annotations.
Keywords that ALWAYS trigger \`propose_document_edit\`: write, add, insert, append, replace, move, summarize into, place, put, create a section, add a section, rewrite.`
    : ''
}
- **Browser Navigation — Inline Links with Narration**: ONLY when the user explicitly asks to navigate to a website, open a URL, or browse a specific page, provide clickable navigation links. Do NOT generate navigation links for general questions, brainstorming, or document editing. TWO link types:
  - Simple (static pages — Wikipedia, docs, articles): \`[Link Text](nav:URL|SectionName)\` — ALWAYS include the pipe and section name.
  - Complex (web apps — Canvas LMS, dashboards, portals): \`[Link Text](nav-pw:URL|action description)\` — use when navigation requires clicking buttons, expanding dropdowns, or multi-step interaction
  - Use \`nav:\` for static content (Wikipedia, documentation, news). Use \`nav-pw:\` for web apps (Canvas, Notion, Google Docs, dashboards). When unsure, use \`nav-pw:\`
  - NEVER invent or hallucinate workspace links, project links, or internal links that don't exist. Only provide navigation links to real, external URLs the user asked about.
  - Do NOT add "Workspace Link:" or "See similar..." references — these are NOT real links

## Current Context
- User: ${userName}
- Current time: ${new Date().toISOString()}
- Workspace: ${workspaceName} (${memberTotal} members)
${contextSection}
${stateContextBlock ? `\n## AI Memory\n${stateContextBlock}\n` : ''}${deepDiveSection}${captureAskSection}${groupContextSection}${webContextSection}${navContextSection}${gwsDocContextSection}${liveActivitySection}${recentEditsSection}${strandContextSection}${projectContextBlock}${docMemoryBlock}
## Recent Activity
${activitySummary}

## Response Style
- Be concise but thorough
- For complex responses, use structured formats (tables, lists, code blocks, comparisons)
- Proactively suggest next steps when appropriate
- Use markdown formatting for readability`
}

/**
 * Build the Capture & Ask section of the system prompt.
 * Provides context-specific instructions based on the capture source.
 */
function buildCaptureAskPrompt(
  captureSource: string | null,
  sourceFileId: string | null,
  _activitySummary: string
): string {
  const sourceLabel = captureSource ?? 'other'

  let sourceGuidance = ''
  switch (sourceLabel) {
    case 'canvas':
      sourceGuidance = `The capture is from a canvas view. Use the read_canvas tool to understand canvas objects.
Describe spatial relationships between objects (e.g., "Box A connects to Box B via an arrow labeled 'depends on'").
Reference who created or last modified objects if you can find that in the timeline.`
      break
    case 'document':
    case 'notes':
      sourceGuidance = `The capture is from a document/notes editor. Use the read_file tool to read the document content.
Compare what's visible in the screenshot with the actual document content.
Mention recent edits or contributors if available from the timeline.`
      break
    case 'spreadsheet':
      sourceGuidance = `The capture is from a spreadsheet editor. Use the read_file tool to access the spreadsheet data.
Describe cell values, formulas, and formatting visible in the screenshot.
Reference any recent cell changes from the timeline.`
      break
    case 'presentation':
      sourceGuidance = `The capture is from a presentation editor. Use the read_file tool to access slide content.
Describe slide layout, text content, and visual elements.
Reference recent slide edits from the timeline.`
      break
    default:
      sourceGuidance = `Use the timeline and workspace context to provide relevant information about what's shown in the screenshot.`
      break
  }

  return `
## Capture & Ask Mode
The user has captured a screenshot of their screen and is asking about it.
- Capture source: ${sourceLabel}
${sourceFileId ? `- Source file ID: ${sourceFileId}` : '- No specific file context'}

### Instructions
1. Describe what you see in the screenshot clearly and accurately
2. Answer the user's question using BOTH the visual content AND your workspace/timeline knowledge
3. Reference specific files, people, and events from the timeline when relevant
4. If the screenshot shows something that conflicts with timeline data, mention the discrepancy

### Source-Specific Guidance
${sourceGuidance}
`
}

/**
 * Build context section for Google Workspace documents.
 * Fetches the external document record and its latest content snapshot
 * to give the chat AI awareness of the Google Doc/Sheet/Slide content.
 */
async function buildGWSDocumentContext(
  externalDocId: string,
  workspaceId: string
): Promise<string> {
  try {
    const [doc] = await db
      .select()
      .from(externalDocuments)
      .where(
        and(eq(externalDocuments.id, externalDocId), eq(externalDocuments.workspaceId, workspaceId))
      )
      .limit(1)

    if (!doc) return ''

    const metadata = (doc.metadata || {}) as Record<string, unknown>
    const contentSnapshot = metadata['lastContentSnapshot'] as string | undefined

    // E-1.4: branch on docType-specific builders so sheets/slides get
    // appropriately formatted AI context rather than a raw text blob.
    if (doc.docType === 'google_sheets') {
      return buildGWSSheetContext(doc, metadata, contentSnapshot)
    }
    if (doc.docType === 'google_slides') {
      return buildGWSSlidesContext(doc, metadata, contentSnapshot)
    }

    // Default: Google Doc — text content
    let section = `
## Google Workspace Document Context
The user is working on a Google Doc titled "${doc.title}".
External Document ID: ${doc.externalDocId}
`

    if (contentSnapshot && contentSnapshot.length > 0) {
      // Truncate to ~10K tokens (~40K chars at ~4 chars/token)
      const truncated = contentSnapshot.slice(0, 40000)
      const lastSync =
        metadata['lastSnapshotAt'] ||
        metadata['lastSignalAt'] ||
        doc.updatedAt?.toISOString() ||
        'unknown'
      section += `
### Document Content (last synced ${lastSync})
${truncated}${contentSnapshot.length > 40000 ? '\n[... document truncated]' : ''}
`
    }

    return section
  } catch (e) {
    console.warn('[SystemPrompt] GWS document context failed:', (e as Error).message)
    return ''
  }
}

/**
 * Build AI context for a Google Sheet. Format:
 *   [GOOGLE SHEET: "Sheet Name"]
 *   Active sheet: Sheet1
 *   Cell data (visible range):
 *   A1: ...
 */
function buildGWSSheetContext(
  doc: { title: string; externalDocId: string; updatedAt: Date | null },
  metadata: Record<string, unknown>,
  contentSnapshot: string | undefined
): string {
  const sheetName = (metadata['lastSheetName'] as string | undefined) || 'Sheet1'
  const lastSync = metadata['lastSnapshotAt'] || doc.updatedAt?.toISOString() || 'unknown'

  const header = `
## Google Workspace Document Context
[GOOGLE SHEET: "${doc.title}"]
External Document ID: ${doc.externalDocId}
Active sheet: ${sheetName}
Last synced: ${lastSync}
`
  if (!contentSnapshot || contentSnapshot.trim().length === 0) {
    return header + `\n(no cell data has been captured yet)\n`
  }
  // Sheets context is terser per the spec — cap at 10K chars.
  const truncated = contentSnapshot.slice(0, 10000)
  const truncNote = contentSnapshot.length > 10000 ? '\n[... cell data truncated]' : ''
  return (
    header +
    `
### Cell data (visible range)
${truncated}${truncNote}
`
  )
}

/**
 * Build AI context for a Google Slides presentation. Format:
 *   [GOOGLE SLIDES: "Presentation Name"]
 *   Current slide: 3 of 12
 *   Slide 3 title: "…"
 *   Slide 3 content: …
 *   Speaker notes: …
 */
function buildGWSSlidesContext(
  doc: { title: string; externalDocId: string; updatedAt: Date | null },
  metadata: Record<string, unknown>,
  contentSnapshot: string | undefined
): string {
  const slideIndex = metadata['lastSlideIndex'] as number | undefined
  const lastSync = metadata['lastSnapshotAt'] || doc.updatedAt?.toISOString() || 'unknown'

  const header = `
## Google Workspace Document Context
[GOOGLE SLIDES: "${doc.title}"]
External Document ID: ${doc.externalDocId}
${slideIndex ? `Current slide: ${slideIndex}` : ''}
Last synced: ${lastSync}
`
  if (!contentSnapshot || contentSnapshot.trim().length === 0) {
    return header + `\n(no slide content has been captured yet)\n`
  }
  // Slides context capped at 8K chars per spec.
  const truncated = contentSnapshot.slice(0, 8000)
  const truncNote = contentSnapshot.length > 8000 ? '\n[... slide content truncated]' : ''
  return (
    header +
    `
### Current slide
${truncated}${truncNote}
`
  )
}

/**
 * Build project context block for project-scoped conversations.
 * Lists all project documents and their summaries.
 */
async function buildProjectContextBlock(spaceId: string): Promise<string> {
  try {
    const { spaces, spaceDocuments } = await import('../../db/schema/spaces')

    const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1)

    if (!space || !space.isProject) return ''

    // Get project documents
    const docs = await db.select().from(spaceDocuments).where(eq(spaceDocuments.spaceId, spaceId))

    if (docs.length === 0) return ''

    // Build document list
    const docDescriptions: string[] = []

    for (const d of docs) {
      if (d.fileId) {
        const [f] = await db.select().from(files).where(eq(files.id, d.fileId)).limit(1)
        if (f) docDescriptions.push(`- **${f.name}** (internal file, ID: ${f.id})`)
      }
      if (d.externalDocumentId) {
        const [ed] = await db
          .select()
          .from(externalDocuments)
          .where(eq(externalDocuments.id, d.externalDocumentId))
          .limit(1)
        if (ed) {
          const typeLabel =
            ed.docType === 'google_docs'
              ? 'Google Doc'
              : ed.docType === 'google_sheets'
                ? 'Google Sheet'
                : 'Google Slides'
          docDescriptions.push(`- **${ed.title}** (${typeLabel}, ID: ${ed.id})`)
        }
      }
    }

    // Get project strand summary
    let strandSummary = ''
    if (space.strandId) {
      const [strand] = await db
        .select()
        .from(strands)
        .where(eq(strands.id, space.strandId))
        .limit(1)
      if (strand?.summaryText) {
        strandSummary = `\n**Project Summary:** ${strand.summaryText}`
      }
    }

    return `
## Project Context: "${space.name}"
${space.description ? `**Description:** ${space.description}` : ''}${strandSummary}

### Project Documents (${docDescriptions.length})
${docDescriptions.join('\n')}

You have access to all documents in this project. When answering questions, consider context from any relevant project document. Cross-document relationships and provenance are tracked automatically.
`
  } catch (e) {
    console.warn('[SystemPrompt] Project context failed:', (e as Error).message)
    return ''
  }
}

/**
 * Build group conversation context block. Lists all members so the AI knows
 * who is in the conversation, and signals that responses are visible to the
 * whole group. Used when conversationType === 'group'.
 */
async function buildGroupContextBlock(
  conversationId: string,
  askingUserName: string
): Promise<string> {
  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1)
  if (!conv) return ''

  const memberRows = await db
    .select({
      userId: chatConversationMembers.userId,
      role: chatConversationMembers.role,
      name: users.name,
      email: users.email,
    })
    .from(chatConversationMembers)
    .leftJoin(users, eq(chatConversationMembers.userId, users.id))
    .where(eq(chatConversationMembers.conversationId, conversationId))

  const memberLines = memberRows
    .map((m) => `- ${m.name ?? m.email ?? 'Unknown'}${m.role === 'owner' ? ' (group owner)' : ''}`)
    .join('\n')

  return `
## Group Conversation Context
You are Follow, an AI assistant in a group conversation titled "${conv.title}".

### Members
${memberLines || '- (no members)'}

${askingUserName} is asking you a question. Address them by name when appropriate.
ALL members can see your response — write for the whole group, not just one person.
When the question references the linked document or shared context, weave that context into your answer.
`
}
