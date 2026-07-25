import type { RichContent, MessageAttachment } from '@workspace/shared/types'
import { buildSystemPrompt } from './system-prompt'
import { getToolDefinitions, executeToolCall } from './tools'
import { getOpenRouterClient } from '../../lib/ai-client'
import { MODEL_TIERS } from '../../config/models'
import { insertSignals } from '../signals'
import { invokeReferenceAgent } from '../reference-agent'
import { db } from '../../db'
import { threadSessions } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'

const MAX_TOKENS = 4096

interface ConversationRow {
  id: string
  workspaceId: string
  userId: string
  title: string
  type: string
  contextObjectId: string | null
  contextObjectType: string | null
  chatSourceType?: string | null
}

interface MessageRow {
  role: string
  content: string
  userId: string | null
  metadata: Record<string, unknown> | null
}

interface CompletionOptions {
  conversation: ConversationRow
  messages: MessageRow[]
  attachments: MessageAttachment[]
  userId: string
  /** Optional model override (e.g. 'deepseek/deepseek-chat-v3-0324:free') */
  modelId?: string
  /** Web browsing context from Chrome extension */
  webContext?: { url?: string; title?: string }
  /** Current section the user is viewing */
  currentSection?: { index: number; title: string }
  /** Document text from frontend (fallback when Yjs server offline) */
  documentContent?: string
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
  onToken: (token: string) => Promise<void>
  onToolStart: (toolName: string) => Promise<void>
  onToolEnd: (toolName: string, result: unknown, durationMs: number) => Promise<void>
  onRichContent: (content: Record<string, unknown>) => Promise<void>
}

interface CompletionResult {
  content: string
  richContent: RichContent[] | null
  model: string
  tokensIn: number
  tokensOut: number
  /** Sources surfaced during this completion (file/section/event references). */
  sources?: Array<{ label: string; type: string; id?: string }>
  /** Sprint RA-2: Reference agent version citations — opaque for caller to persist. */
  versionCitations?: Array<Record<string, unknown>>
  /** Sprint RA-2: Reference agent intent classification (when agent activated). */
  agentIntent?: string | null
  /** Sprint CTX-2: query routing type ('index' or 'directory'). */
  queryType?: 'index' | 'directory'
  /** Sprint CTX-2: why the directory path was chosen (contested | multi-contributor | ...). */
  routingReason?: string
  /** Sprint CTX-2: contributor profiles surfaced for UI rendering. */
  contributors?: Array<Record<string, unknown>>
}

/**
 * Build OpenAI-format messages from conversation history and attachments.
 * Handles both text-only and multi-modal (image) messages.
 * Exported for testability.
 */
export function buildClaudeMessages(
  messages: MessageRow[],
  attachments: MessageAttachment[]
): ChatCompletionMessageParam[] {
  const chatMessages: ChatCompletionMessageParam[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

  if (chatMessages.length === 0) return chatMessages

  const lastMsg = chatMessages[chatMessages.length - 1]
  if (!lastMsg || lastMsg.role !== 'user') return chatMessages

  // Check for image attachments (vision support)
  const imageAttachments = attachments.filter((a) => a.imageData)
  const fileAttachments = attachments.filter((a) => !a.imageData)

  if (imageAttachments.length > 0) {
    // Build multi-modal content blocks: images first, then text
    const contentBlocks: OpenAI.Chat.Completions.ChatCompletionContentPart[] = []

    for (const img of imageAttachments) {
      const imageBlock = parseImageData(img.imageData!)
      if (imageBlock) {
        contentBlocks.push(imageBlock)
      }
    }

    // Add file attachment context
    let textContent = typeof lastMsg.content === 'string' ? lastMsg.content : ''

    // Add web context from screenshot metadata
    const webScreenshot = imageAttachments.find((a) => a.metadata?.url)
    if (webScreenshot?.metadata) {
      textContent = `[User is browsing: ${webScreenshot.metadata.url} — "${webScreenshot.metadata.title || 'Unknown page'}"]\n\n${textContent}`
    }

    if (fileAttachments.length > 0) {
      const attachmentContext = fileAttachments
        .map((a) => `[Attached file: ${a.fileName ?? 'file'} (${a.fileType ?? 'unknown'})]`)
        .join('\n')
      textContent = `${textContent}\n\n${attachmentContext}`
    }

    contentBlocks.push({ type: 'text', text: textContent })
    // OpenAI SDK types don't expose multimodal content part union on message content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lastMsg.content = contentBlocks as any
  } else if (fileAttachments.length > 0) {
    // Text-only: add file attachment context
    if (typeof lastMsg.content === 'string') {
      const attachmentContext = fileAttachments
        .map((a) => `[Attached file: ${a.fileName ?? 'file'} (${a.fileType ?? 'unknown'})]`)
        .join('\n')
      lastMsg.content = `${lastMsg.content}\n\n${attachmentContext}`
    }
  }

  return chatMessages
}

/**
 * Parse a base64 data URL into an OpenAI image_url content part.
 */
function parseImageData(
  imageData: string
): OpenAI.Chat.Completions.ChatCompletionContentPartImage | null {
  // Handle data URL format: data:image/png;base64,iVBOR...
  const dataUrlMatch = imageData.match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/)
  if (dataUrlMatch) {
    return {
      type: 'image_url',
      image_url: { url: imageData },
    }
  }

  // If it's raw base64 without data URL prefix, assume PNG
  if (imageData.length > 100 && !imageData.startsWith('http')) {
    return {
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${imageData}` },
    }
  }

  return null
}

export async function createChatCompletion(options: CompletionOptions): Promise<CompletionResult> {
  try {
    return await _createChatCompletionReal(options)
  } catch (err) {
    const errObj = err as Error & { status?: number; error?: unknown }
    const modelUsed = options.modelId ?? MODEL_TIERS.CHAT_AGENT
    console.error('[Chat] AI completion failed, using dev fallback:', {
      message: errObj.message,
      status: errObj.status,
      error: errObj.error,
      model: modelUsed,
      hasKey: !!(process.env['OPENROUTER_API_KEY'] ?? ''),
    })
    return await _createDevFallbackResponse(options, {
      message: errObj.message ?? 'Unknown error',
      status: errObj.status,
      model: modelUsed,
    })
  }
}

async function _createDevFallbackResponse(
  options: CompletionOptions,
  errorDetail?: { message: string; status?: number; model: string }
): Promise<CompletionResult> {
  const { messages, attachments, onToken } = options
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const userText = lastUserMsg?.content ?? '(empty message)'

  const webScreenshot = attachments.find((a) => a.imageData && a.metadata?.url)
  const webInfo = webScreenshot?.metadata
    ? `\n\nI can see you're on **${webScreenshot.metadata.title || 'a page'}** (${webScreenshot.metadata.url}).`
    : ''

  const errorHint =
    (process.env['OPENROUTER_API_KEY'] ?? '')
      ? 'Your API key may be invalid or expired. Check your `OPENROUTER_API_KEY`.'
      : 'Set `OPENROUTER_API_KEY` in `packages/api/.env.local`.'

  const errorBlock = errorDetail
    ? `\n\n**Error:** \`${errorDetail.status ?? '???'} — ${errorDetail.message}\`\n**Model:** \`${errorDetail.model}\``
    : ''

  const devResponse = `**[Dev Mode — AI unavailable]**\n\nI received your message: "${userText}"${webInfo}\n\n${errorHint}${errorBlock}`

  const words = devResponse.split(' ')
  for (let i = 0; i < words.length; i++) {
    await onToken((i === 0 ? '' : ' ') + words[i])
    await new Promise((r) => setTimeout(r, 12))
  }

  return {
    content: devResponse,
    richContent: null,
    model: 'dev-echo',
    tokensIn: 0,
    tokensOut: 0,
  }
}

/**
 * Convert our tool definitions to OpenAI function-calling format.
 */
function toOpenAITools(
  tools: Array<{ name: string; description: string; input_schema: unknown }>
): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }))
}

async function _createChatCompletionReal(options: CompletionOptions): Promise<CompletionResult> {
  const { conversation, messages, attachments, userId, modelId, onToken, onToolStart, onToolEnd } =
    options

  // Auto-switch to vision-capable model when images are present
  const hasImages = attachments.some((a) => a.imageData)
  const defaultModel = hasImages ? MODEL_TIERS.CHAT_AGENT_VISION : MODEL_TIERS.CHAT_AGENT
  const activeModel = modelId ?? defaultModel

  // Sprint RA-2: Reference Agent — classify → plan → retrieve → assemble.
  // The agent runs on every chat request but bypasses for simple queries
  // (edit commands, general knowledge). For complex queries it builds a
  // version-cited context block that we append to the system prompt.
  // Fail-open: any error → stay on the existing fast path.
  let agentContextBlock = ''
  let agentVersionCitations: Array<Record<string, unknown>> = []
  let agentIntent: string | null = null
  try {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const userQuery = lastUserMessage?.content ?? ''
    if (userQuery.trim().length > 0) {
      const externalDocId =
        conversation.contextObjectType === 'external_document'
          ? (conversation.contextObjectId ?? undefined)
          : undefined
      const documentId =
        conversation.contextObjectType === 'file' || conversation.contextObjectType === 'document'
          ? (conversation.contextObjectId ?? undefined)
          : undefined
      const agentResult = await invokeReferenceAgent({
        query: userQuery,
        workspaceId: conversation.workspaceId,
        userId,
        documentId,
        externalDocId,
      })
      if (!agentResult.bypassed && agentResult.context) {
        agentContextBlock = agentResult.context.contextBlock
        agentVersionCitations = agentResult.context.versionCitations as unknown as Array<
          Record<string, unknown>
        >
        agentIntent = agentResult.classification.intent
        console.info(
          '[ReferenceAgent] Context injected:',
          JSON.stringify(agentResult.context.summary)
        )
      }
    }
  } catch (err) {
    console.warn('[ReferenceAgent] Invocation failed, using fast path:', err)
  }

  // Build system prompt
  let systemPrompt = await buildSystemPrompt({
    workspaceId: conversation.workspaceId,
    userId,
    conversationId: conversation.id,
    conversationType: conversation.type,
    contextObjectId: conversation.contextObjectId,
    contextObjectType: conversation.contextObjectType,
    currentSection: options.currentSection,
    documentContent: options.documentContent,
    webContext: options.webContext,
    navContext: options.navContext,
    recentDocumentEdits: options.recentDocumentEdits,
  })

  // Sprint RA-2: append reference agent context (if the agent produced one).
  // The agent runs for complex queries only; simple queries bypass and this
  // block is empty, so the fast-path system prompt is unchanged.
  if (agentContextBlock) {
    systemPrompt = systemPrompt + '\n\n' + agentContextBlock
  }

  // Build message history with vision support
  const userMessages = buildClaudeMessages(messages, attachments)

  // Get tool definitions and convert to OpenAI format
  const rawTools = getToolDefinitions({
    workspaceId: conversation.workspaceId,
    contextObjectType: conversation.contextObjectType,
    contextObjectId: conversation.contextObjectId,
    hasDocumentContent: !!options.documentContent,
  })
  const tools = rawTools.length > 0 ? toOpenAITools(rawTools) : undefined

  console.info('[Chat] Completion setup:', {
    model: activeModel,
    contextObjectType: conversation.contextObjectType,
    hasDocumentContent: !!options.documentContent,
    docContentLen: options.documentContent?.length ?? 0,
    toolCount: rawTools.length,
    toolNames: rawTools.map((t) => t.name),
    systemPromptLen: systemPrompt.length,
    hasGWSInstructions: systemPrompt.includes('propose_document_edit'),
  })

  // Agentic loop - supports multi-step tool use
  let totalTokensIn = 0
  let totalTokensOut = 0
  let fullContent = ''
  const currentMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...userMessages,
  ]
  let iterations = 0
  const maxIterations = 5

  // Sources collected from tool results (files read, sections searched, etc.)
  const collectedSources: Array<{ label: string; type: string; id?: string }> = []
  const seenSourceKeys = new Set<string>()
  const addSource = (s: { label: string; type: string; id?: string }) => {
    const key = `${s.type}:${s.id ?? s.label}`
    if (seenSourceKeys.has(key)) return
    seenSourceKeys.add(key)
    collectedSources.push(s)
  }

  const client = getOpenRouterClient()

  while (iterations < maxIterations) {
    iterations++

    const stream = await client.chat.completions.create({
      model: activeModel,
      max_tokens: MAX_TOKENS,
      messages: currentMessages,
      tools,
      stream: true,
    })

    let hasToolUse = false
    const toolCalls: Array<{
      id: string
      function: { name: string; arguments: string }
    }> = []
    let currentText = ''

    // Process stream events
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      if (!choice) continue

      // Accumulate text content
      const delta = choice.delta
      if (delta?.content) {
        currentText += delta.content
        await onToken(delta.content)
      }

      // Accumulate tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id ?? '',
              function: { name: tc.function?.name ?? '', arguments: '' },
            }
          }
          if (tc.id) toolCalls[idx]!.id = tc.id
          if (tc.function?.name) toolCalls[idx]!.function.name = tc.function.name
          if (tc.function?.arguments) toolCalls[idx]!.function.arguments += tc.function.arguments
        }
      }

      // Track usage from the final chunk
      if (chunk.usage) {
        totalTokensIn += chunk.usage.prompt_tokens ?? 0
        totalTokensOut += chunk.usage.completion_tokens ?? 0
      }
    }

    // Check for tool use
    const validToolCalls = toolCalls.filter((tc) => tc && tc.function.name)
    hasToolUse = validToolCalls.length > 0

    if (!hasToolUse) {
      fullContent += currentText
      break
    }

    // Execute tool calls
    fullContent += currentText

    // Add assistant message with tool calls
    currentMessages.push({
      role: 'assistant',
      content: currentText || null,
      tool_calls: validToolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    })

    // Execute each tool and collect results
    for (const toolCall of validToolCalls) {
      await onToolStart(toolCall.function.name)
      const startTime = Date.now()

      try {
        const input = JSON.parse(toolCall.function.arguments || '{}')
        const result = await executeToolCall(
          toolCall.function.name,
          input as Record<string, unknown>,
          conversation.workspaceId,
          userId,
          conversation.contextObjectType,
          conversation.contextObjectId,
          options.documentContent
        )
        const durationMs = Date.now() - startTime
        await onToolEnd(toolCall.function.name, result, durationMs)

        // Extract sources from tool result
        try {
          extractSourcesFromToolResult(toolCall.function.name, result, addSource)
        } catch {
          // non-fatal
        }

        const toolMsg: ChatCompletionToolMessageParam = {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        }
        currentMessages.push(toolMsg)
      } catch (err) {
        const durationMs = Date.now() - startTime
        const errorMsg = err instanceof Error ? err.message : 'Tool execution failed'
        await onToolEnd(toolCall.function.name, { error: errorMsg }, durationMs)

        const toolMsg: ChatCompletionToolMessageParam = {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: ${errorMsg}`,
        }
        currentMessages.push(toolMsg)
      }
    }
  }

  // Extract rich content from the response
  const richContent = extractRichContent(fullContent)

  // Emit native AI turn signal if user has an active AI thread session
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const toolsUsed = currentMessages
    .filter((m) => m.role === 'assistant' && 'tool_calls' in m && m.tool_calls)
    .flatMap((m) =>
      'tool_calls' in m && m.tool_calls
        ? m.tool_calls.map((tc) => {
            if ('function' in tc) return tc.function.name
            return ''
          })
        : []
    )
    .filter(Boolean)

  emitNativeAiTurnSignal({
    workspaceId: conversation.workspaceId,
    userId,
    promptLength: lastUserMsg?.content?.length ?? 0,
    responseLength: fullContent.length,
    model: activeModel,
    turnIndex: iterations,
    toolsUsed,
    chatSourceType: conversation.chatSourceType ?? 'follow-web',
  }).catch(() => {}) // non-blocking, fire-and-forget

  // WIRE-1: log LLM usage for cost tracking (non-blocking)
  if (userId) {
    import('../../lib/llm-logger')
      .then(({ logLLMUsage }) =>
        logLLMUsage({
          userId,
          model: activeModel,
          modelTier: 'CHAT_AGENT',
          inputTokens: totalTokensIn,
          outputTokens: totalTokensOut,
          source: 'chat',
        })
      )
      .catch(() => {})
  }

  return {
    content: fullContent,
    richContent: richContent.length > 0 ? richContent : null,
    model: activeModel,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    sources: collectedSources.length > 0 ? collectedSources : undefined,
    versionCitations: agentVersionCitations.length > 0 ? agentVersionCitations : undefined,
    agentIntent,
  }
}

/**
 * Inspect a tool result and add any referenced files / sections / events
 * to the running source list. Best-effort: tool result shapes vary.
 */
function extractSourcesFromToolResult(
  toolName: string,
  result: unknown,
  addSource: (s: { label: string; type: string; id?: string }) => void
) {
  if (!result || typeof result !== 'object') return
  const r = result as Record<string, unknown>

  // search_files / list_files: { files: [{ id, name }] }
  if ((toolName === 'search_files' || toolName === 'list_files') && Array.isArray(r.files)) {
    for (const f of r.files as Array<{ id?: string; name?: string }>) {
      if (f.name) addSource({ label: f.name, type: 'file', id: f.id })
    }
  }

  // read_file / read_file_section: { fileName, sectionTitle? }
  if (toolName === 'read_file' || toolName === 'read_file_section') {
    const name = (r.fileName ?? r.name ?? r.title) as string | undefined
    if (name) {
      const label = r.sectionTitle ? `${name} → ${r.sectionTitle}` : name
      addSource({ label, type: 'file', id: r.fileId as string | undefined })
    }
  }

  // get_timeline_summary: { events: [{ title }] }
  if (toolName === 'get_timeline_summary' && Array.isArray(r.events)) {
    const count = (r.events as unknown[]).length
    if (count > 0) addSource({ label: `${count} timeline events`, type: 'timeline' })
  }

  // read_canvas / read_notebook: { name, id }
  if ((toolName === 'read_canvas' || toolName === 'read_notebook') && r.name) {
    addSource({
      label: r.name as string,
      type: toolName === 'read_canvas' ? 'canvas' : 'notebook',
      id: r.id as string | undefined,
    })
  }
}

/**
 * Parse the AI response and extract structured rich content.
 * Detects code blocks, tables, and other patterns.
 */
function extractRichContent(content: string): RichContent[] {
  const richBlocks: RichContent[] = []

  // Extract code blocks -> code_sandbox
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  let match
  while ((match = codeBlockRegex.exec(content)) !== null) {
    richBlocks.push({
      type: 'code_sandbox',
      data: {
        language: match[1] || 'text',
        code: match[2]?.trim() ?? '',
      },
    })
  }

  // Extract markdown tables -> table
  const tableRegex = /\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g
  while ((match = tableRegex.exec(content)) !== null) {
    const headers =
      match[1]
        ?.split('|')
        .map((h) => h.trim())
        .filter(Boolean) ?? []
    const rowLines = match[2]?.trim().split('\n') ?? []
    const rows = rowLines.map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
    )
    richBlocks.push({
      type: 'table',
      data: { headers, rows },
    })
  }

  return richBlocks
}

/**
 * Emit a native AI turn signal to ClickHouse thread_signals.
 * Only emits when the user has an active AI-type thread session.
 */
async function emitNativeAiTurnSignal(params: {
  workspaceId: string
  userId: string
  promptLength: number
  responseLength: number
  model: string
  turnIndex: number
  toolsUsed: string[]
  chatSourceType: string
}): Promise<void> {
  try {
    // Check if user has an active AI thread session
    const activeSessions = await db
      .select()
      .from(threadSessions)
      .where(and(eq(threadSessions.userId, params.userId), eq(threadSessions.status, 'active')))

    // Find an AI-type session (join through threads would be ideal, but we check metadata)
    // For simplicity, emit for any active session — the distiller will route to the right thread
    const activeSession = activeSessions[0]
    if (!activeSession) return

    await insertSignals([
      {
        sessionId: activeSession.recordingSessionId || activeSession.id,
        threadId: activeSession.threadId,
        workspaceId: params.workspaceId,
        userId: params.userId,
        signalType: 'ai_turn_native',
        domain: 'follow.so',
        metadata: {
          prompt_length: params.promptLength,
          response_length: params.responseLength,
          model: params.model,
          turn_index: params.turnIndex,
          tools_used: params.toolsUsed,
          chat_source_type: params.chatSourceType,
        },
      },
    ])
  } catch (err) {
    // Non-fatal — don't break chat for signal emission failures
    console.warn('[Chat] Failed to emit AI turn signal:', (err as Error).message)
  }
}
