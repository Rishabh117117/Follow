/**
 * Content Chunker
 *
 * Splits document content into overlapping chunks for embedding.
 * Supports section-aware splitting (prefers heading boundaries).
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface ContentChunk {
  text: string
  index: number
  startOffset: number
  endOffset: number
  metadata: {
    sectionTitle?: string
    paragraphRange?: [number, number]
  }
}

export interface ChunkOptions {
  chunkSize?: number       // target tokens per chunk (default 512)
  overlap?: number         // overlap tokens (default 64)
  sectionAware?: boolean   // split on headings first (default true)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4

function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN
}

/**
 * Detect heading patterns in text (markdown or HTML).
 */
function findSectionBreaks(content: string): number[] {
  const breaks: number[] = []
  const patterns = [
    /^#{1,6}\s+/gm,                  // Markdown headings
    /<h[1-6][^>]*>/gi,               // HTML headings
    /\n(?=[A-Z][^\n]{5,80}\n[=-]{3,})/g, // Setext-style headings
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      breaks.push(match.index)
    }
  }

  return [...new Set(breaks)].sort((a, b) => a - b)
}

/**
 * Extract section title from text at a given offset.
 */
function extractSectionTitle(content: string, offset: number): string | undefined {
  const slice = content.slice(offset, offset + 200)
  const match = slice.match(/^#{1,6}\s+(.+?)(?:\n|$)/) ||
                slice.match(/<h[1-6][^>]*>(.+?)<\/h/i) ||
                slice.match(/^(.+?)\n[=-]{3,}/)
  return match?.[1]?.trim()
}

// ─── Main Chunker ─────────────────────────────────────────────────────────

/**
 * Split document content into overlapping chunks.
 *
 * Strategy:
 * 1. If sectionAware, split at heading boundaries first
 * 2. For each section, apply fixed-window chunking with overlap
 * 3. Never split mid-word
 */
export function chunkDocument(
  content: string,
  options?: ChunkOptions
): ContentChunk[] {
  const chunkSize = tokensToChars(options?.chunkSize ?? 512)
  const overlap = tokensToChars(options?.overlap ?? 64)
  const sectionAware = options?.sectionAware ?? true

  if (!content || content.trim().length === 0) return []

  // For very short content, return as single chunk
  if (content.length <= chunkSize) {
    return [{
      text: content,
      index: 0,
      startOffset: 0,
      endOffset: content.length,
      metadata: { sectionTitle: extractSectionTitle(content, 0) },
    }]
  }

  // Split into sections if section-aware
  const sections: Array<{ start: number; end: number; title?: string }> = []

  if (sectionAware) {
    const breaks = findSectionBreaks(content)
    if (breaks.length > 0) {
      // Add section from start to first heading
      if (breaks[0]! > 0) {
        sections.push({ start: 0, end: breaks[0]! })
      }
      // Add each heading section
      for (let i = 0; i < breaks.length; i++) {
        const start = breaks[i]!
        const end = i + 1 < breaks.length ? breaks[i + 1]! : content.length
        sections.push({
          start,
          end,
          title: extractSectionTitle(content, start),
        })
      }
    }
  }

  // If no sections found, treat entire content as one section
  if (sections.length === 0) {
    sections.push({ start: 0, end: content.length })
  }

  // Chunk each section with fixed-window overlap
  const chunks: ContentChunk[] = []

  for (const section of sections) {
    const sectionText = content.slice(section.start, section.end)

    if (sectionText.length <= chunkSize) {
      chunks.push({
        text: sectionText,
        index: chunks.length,
        startOffset: section.start,
        endOffset: section.end,
        metadata: { sectionTitle: section.title },
      })
      continue
    }

    // Fixed-window chunking within section
    let pos = 0
    while (pos < sectionText.length) {
      let end = Math.min(pos + chunkSize, sectionText.length)

      // Don't split mid-word — find nearest whitespace
      if (end < sectionText.length) {
        const lastSpace = sectionText.lastIndexOf(' ', end)
        if (lastSpace > pos + chunkSize * 0.5) {
          end = lastSpace + 1
        }
      }

      const chunkText = sectionText.slice(pos, end)
      if (chunkText.trim().length > 0) {
        chunks.push({
          text: chunkText,
          index: chunks.length,
          startOffset: section.start + pos,
          endOffset: section.start + end,
          metadata: { sectionTitle: section.title },
        })
      }

      // Advance with overlap
      pos = end - overlap
      if (pos <= chunks[chunks.length - 1]?.startOffset! - section.start) {
        pos = end // Prevent infinite loop
      }
    }
  }

  // Re-index
  chunks.forEach((c, i) => { c.index = i })

  return chunks
}
