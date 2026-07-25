/**
 * Embedding Text Composer (Sprint IX-1)
 *
 * Transforms thread events into structured text suitable for embedding.
 * Five templates (one per thread type) produce composite strings that
 * capture the semantic content of each event for vector search.
 */

const MAX_TEXT_LENGTH = 8000

/** Map 3-tier thread event magnitude to 5-tier index magnitude */
export function mapMagnitude(eventMagnitude: string): string {
  switch (eventMagnitude) {
    case 'low':
      return 'small'
    case 'medium':
      return 'medium'
    case 'high':
      return 'large'
    default:
      return 'small'
  }
}

export interface ComposeInput {
  event: {
    label: string
    type: string
    magnitude: string
    keyChange: boolean
    contextNotes: string | null
    metadata: Record<string, unknown>
  }
  threadType: string // doc | ai | browser | user | import
  userName: string | null
  documentTitle: string | null
  sectionAlias: string | null
  // Sprint IX-8: version-linking (optional for back-compat with existing callers)
  sourceVersion?: number | null
  indexedAt?: Date | null
}

/**
 * Compose embedding text from a thread event and its context.
 * Returns a structured text string suitable for text-embedding-3-small.
 */
export function composeEmbeddingText(input: ComposeInput): string {
  const { event, threadType, userName, documentTitle, sectionAlias } = input
  const magnitude = mapMagnitude(event.magnitude)
  const user = userName ?? 'Unknown user'

  let lines: string[]

  switch (threadType) {
    case 'doc':
      lines = buildDocTemplate(user, event, magnitude, documentTitle, sectionAlias)
      break
    case 'ai':
      lines = buildAITemplate(user, event, magnitude, documentTitle, sectionAlias)
      break
    case 'browser':
      lines = buildBrowserTemplate(user, event, magnitude, documentTitle, sectionAlias)
      break
    case 'user':
      lines = buildUserTemplate(user, event, magnitude, documentTitle, sectionAlias)
      break
    case 'import':
      lines = buildImportTemplate(user, event, magnitude, documentTitle)
      break
    default:
      lines = buildUserTemplate(user, event, magnitude, documentTitle, sectionAlias)
  }

  const text = lines.filter(Boolean).join('\n')
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
}

// ─── Templates ───────────────────────────────────────────────────────────────

function buildDocTemplate(
  user: string,
  event: ComposeInput['event'],
  magnitude: string,
  docTitle: string | null,
  section: string | null
): string[] {
  const meta = event.metadata
  const keyTag = event.keyChange ? ', key change' : ''
  // DOC-FACTS-B0: when a document-fact extractor populated the chunk text, embed
  // it so the doc fact's vector carries the actual content (parity with
  // buildAITemplate). Doc-edit signals don't set chunkContent → unaffected.
  const chunkContent = (meta?.chunkContent as string | undefined)?.trim() || null
  return [
    `[DOC] ${user} edited${section ? ` "${section}"` : ''}`,
    docTitle ? `Document: ${docTitle}` : null,
    `Action: ${event.label}`,
    chunkContent ? `Content: ${chunkContent}` : null,
    event.contextNotes ? `Context: ${event.contextNotes}` : null,
    `Detail: ${magnitude} change${keyTag}`,
    meta?.wordDelta != null
      ? `Words: ${Number(meta.wordDelta) > 0 ? '+' : ''}${meta.wordDelta}`
      : null,
  ].filter((l): l is string => l !== null)
}

function buildAITemplate(
  user: string,
  event: ComposeInput['event'],
  magnitude: string,
  docTitle: string | null,
  section: string | null
): string[] {
  const meta = event.metadata
  const outcome = (meta?.outcome as string) ?? (meta?.action as string) ?? 'interaction'
  // Prefer the full chunk text when a chat-artifact extractor populated it,
  // otherwise fall back to the label. Without this, the AI template used to
  // emit only "{user} chatted ... small interaction" and the embedding lost
  // all of the actual message content.
  const chunkContent = (meta?.chunkContent as string | undefined)?.trim() || null
  return [
    `[AI] ${user} chatted${section ? ` about "${section}"` : ''}`,
    docTitle ? `Document: ${docTitle}` : null,
    `Summary: ${event.label}`,
    chunkContent ? `Content: ${chunkContent}` : null,
    meta?.questionSummary ? `Question: ${meta.questionSummary}` : null,
    meta?.responseSummary ? `Response: ${meta.responseSummary}` : null,
    `Outcome: ${outcome}`,
    event.contextNotes ? `Context: ${event.contextNotes}` : null,
    `Detail: ${magnitude} interaction${event.keyChange ? ', key change' : ''}`,
  ].filter((l): l is string => l !== null)
}

function buildBrowserTemplate(
  user: string,
  event: ComposeInput['event'],
  magnitude: string,
  docTitle: string | null,
  section: string | null
): string[] {
  const meta = event.metadata
  const pageTitle = (meta?.pageTitle as string) ?? (meta?.title as string)
  const domain = (meta?.domain as string) ?? (meta?.url as string)
  const duration = meta?.timeOnPage as number | undefined
  return [
    `[BROWSE] ${user} researched${pageTitle ? ` "${pageTitle}"` : ''}`,
    domain ? `URL: ${domain}` : null,
    duration ? `Duration: ${duration}s` : null,
    docTitle ? `Document context: ${docTitle}` : null,
    section ? `Section context: ${section}` : null,
    event.contextNotes ? `Context: ${event.contextNotes}` : null,
    `Detail: ${magnitude}${event.keyChange ? ', key change' : ''}`,
  ].filter((l): l is string => l !== null)
}

function buildUserTemplate(
  user: string,
  event: ComposeInput['event'],
  magnitude: string,
  docTitle: string | null,
  section: string | null
): string[] {
  return [
    `[ACTIVITY] ${user} ${event.label}`,
    docTitle ? `Document: ${docTitle}` : null,
    section ? `Focus: ${section}` : null,
    event.contextNotes ? `Pattern: ${event.contextNotes}` : null,
    `Detail: ${magnitude}${event.keyChange ? ', key change' : ''}`,
  ].filter((l): l is string => l !== null)
}

function buildImportTemplate(
  user: string,
  event: ComposeInput['event'],
  magnitude: string,
  docTitle: string | null
): string[] {
  const meta = event.metadata
  const source = (meta?.sourcePlatform as string) ?? (meta?.importSource as string) ?? 'external'
  const topic = meta?.conversationTopic as string | undefined
  const highlights = meta?.importedHighlights as string | undefined
  return [
    `[IMPORT] ${user} imported from ${source}`,
    topic ? `Topic: ${topic}` : null,
    docTitle ? `Document context: ${docTitle}` : null,
    highlights ? `Key points: ${highlights}` : null,
    event.contextNotes ? `Context: ${event.contextNotes}` : null,
    `Detail: ${magnitude}${event.keyChange ? ', key change' : ''}`,
  ].filter((l): l is string => l !== null)
}

// ─── Tensor Facet Composers (Sprint IX-7) ──────────────────────────────────

/**
 * Compose the CONTENT facet text — WHAT happened.
 *
 * FACET-FIX-1: carries the genuine substance (chat chunk text / doc block plain
 * text), NOT contextNotes. Appending contextNotes here was the overlap source
 * that flattened the content↔causal geometry (it's WHY/where-ish, not WHAT).
 */
export function composeContentFacet(input: ComposeInput): string {
  const { event } = input
  let text = `${event.label}`

  const chunkContent = (event.metadata?.chunkContent as string | undefined)?.trim()
  if (event.metadata?.blockType) {
    text += ` [${event.metadata.blockType} block]`
    if (event.metadata.plainText) {
      text += ` "${(event.metadata.plainText as string).slice(0, 400)}"`
    }
    if (event.metadata.blockType === 'freehand' || event.metadata.blockType === 'shape') {
      text += ' (visual/sketch content)'
    }
  } else if (chunkContent) {
    // Chat / artifact path: the real text of WHAT was said.
    text += `. ${chunkContent.slice(0, 400)}`
  }

  return text.slice(0, 500)
}

/**
 * Compose the CAUSAL facet text — WHY this happened.
 * Focused on reasoning chain for "why" queries.
 */
export function composeCausalFacet(input: ComposeInput): string {
  const { event } = input
  const parts: string[] = []

  // FACET-FIX-1: genuine reasoning only. A bare topic list ("Topics: a, b") is
  // NOT a reason — it's the same signal as content, and routing it here was the
  // overlap that collapsed the contradiction geometry. Guard against it even if
  // an upstream caller still sets contextNotes that way.
  if (event.contextNotes && !/^\s*topics:/i.test(event.contextNotes)) {
    parts.push(`Reason: ${event.contextNotes}`)
  }
  if (event.metadata?.chatQuestion) {
    parts.push(`After asking: "${(event.metadata.chatQuestion as string).slice(0, 150)}"`)
  }
  if (event.metadata?.outcome) {
    parts.push(`Outcome: ${event.metadata.outcome}`)
  }
  if (event.metadata?.blockType === 'freehand') {
    parts.push('Sketched/drew — visual thinking or diagramming')
  }
  if (event.keyChange) {
    parts.push('This was a deliberate, significant change')
  }

  // FACET-FIX-1: no genuine WHY ⇒ empty string. The indexer stores NULL, and
  // the facet-cosine path treats a null causal as "no causal comparison" (falls
  // back to the scalar) — which is correct: a pair with no real WHY on either
  // side must not be judged a contradiction by geometry. NEVER fall back to
  // event.label (that copies WHAT into WHY).
  return parts.join('. ').slice(0, 400)
}

/**
 * Compose the CONTEXT facet text — WHERE this happened.
 * Focused on location/environment for section matching.
 */
export function composeContextFacet(input: ComposeInput): string {
  const { event, documentTitle, sectionAlias, sourceVersion, indexedAt } = input
  const parts: string[] = []

  if (documentTitle) parts.push(`Document: ${documentTitle}`)
  if (sectionAlias) parts.push(`Section: ${sectionAlias}`)

  if (event.metadata?.pageNumber) parts.push(`Page ${event.metadata.pageNumber}`)
  if (event.metadata?.blockPosition) parts.push(`Position: ${event.metadata.blockPosition}`)

  parts.push(`${event.magnitude} ${event.type}`)

  // Sprint IX-8: version-awareness in the 512d context embedding
  if (sourceVersion != null) {
    parts.push(`source version: v${sourceVersion}`)
  }
  if (indexedAt) {
    parts.push(`indexed: ${indexedAt.toISOString()}`)
  }

  return parts.join('. ').slice(0, 400) || 'Unknown context'
}
