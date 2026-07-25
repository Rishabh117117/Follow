/**
 * Yjs Text Extractor
 *
 * Decodes Yjs CRDT state (base64) into structured plain text with heading hierarchy.
 * Walks Y.XmlFragment tree directly — no TipTap dependency on the backend.
 *
 * TipTap Collaboration stores content in Y.XmlFragment('default').
 * Children are Y.XmlElement (paragraph, heading, bulletList, etc.) and Y.XmlText.
 */

import * as Y from 'yjs'
import { getDocState } from '../../ws/yjs-server'

// ── Types ──────────────────────────────────────────────────────────────

export interface DocumentSection {
  headingLevel: number // 1-3 (0 = preamble before first heading)
  title: string
  startCharIndex: number
  endCharIndex: number
  wordCount: number
  textContent: string
  paragraphCount: number
}

export interface DocumentOutline {
  sections: DocumentSection[]
  totalWordCount: number
  totalCharCount: number
  fullText: string
  headingHierarchy: string // compact: "1. Intro (200w) / 2. Methods (800w)"
}

interface HeadingMark {
  level: number
  title: string
  charIndex: number
}

// ── Fragment Walking ───────────────────────────────────────────────────

/**
 * Recursively extract text from a Y.XmlFragment or Y.XmlElement.
 * Tracks heading positions for section splitting.
 */
function walkNode(
  node: Y.XmlFragment | Y.XmlElement | Y.XmlText,
  result: { text: string; headings: HeadingMark[]; paragraphCount: number }
): void {
  if (node instanceof Y.XmlText) {
    result.text += node.toString()
    return
  }

  // XmlFragment and XmlElement both have toArray()
  const children = node.toArray()

  // Check if this is a heading element
  if (node instanceof Y.XmlElement && node.nodeName === 'heading') {
    const level = node.getAttribute('level')
    const headingLevel = typeof level === 'number' ? level : parseInt(String(level), 10) || 1
    const charIndex = result.text.length

    // Extract heading text from children
    const headingTextStart = result.text.length
    for (const child of children) {
      walkNode(child as Y.XmlFragment | Y.XmlElement | Y.XmlText, result)
    }
    const headingText = result.text.slice(headingTextStart).trim()

    result.headings.push({
      level: headingLevel,
      title: headingText || 'Untitled Section',
      charIndex,
    })

    result.text += '\n'
    result.paragraphCount++
    return
  }

  // Block-level elements that produce line breaks
  const blockNodes = new Set([
    'paragraph',
    'codeBlock',
    'blockquote',
    'horizontalRule',
    'table',
    'tableRow',
  ])

  // List items
  const listItemNodes = new Set(['listItem', 'taskItem'])

  if (node instanceof Y.XmlElement) {
    const name = node.nodeName

    if (blockNodes.has(name)) {
      for (const child of children) {
        walkNode(child as Y.XmlFragment | Y.XmlElement | Y.XmlText, result)
      }
      result.text += '\n'
      if (name === 'paragraph' || name === 'codeBlock' || name === 'blockquote') {
        result.paragraphCount++
      }
      return
    }

    if (listItemNodes.has(name)) {
      result.text += '• '
      for (const child of children) {
        walkNode(child as Y.XmlFragment | Y.XmlElement | Y.XmlText, result)
      }
      result.text += '\n'
      result.paragraphCount++
      return
    }

    if (name === 'horizontalRule') {
      result.text += '---\n'
      return
    }

    // Table cells get a tab separator
    if (name === 'tableCell' || name === 'tableHeader') {
      for (const child of children) {
        walkNode(child as Y.XmlFragment | Y.XmlElement | Y.XmlText, result)
      }
      result.text += '\t'
      return
    }
  }

  // Default: recurse into children (handles XmlFragment, bulletList, orderedList, taskList, etc.)
  for (const child of children) {
    walkNode(child as Y.XmlFragment | Y.XmlElement | Y.XmlText, result)
  }
}

// ── Section Splitting ──────────────────────────────────────────────────

function splitIntoSections(fullText: string, headings: HeadingMark[]): DocumentSection[] {
  // Empty document — no sections
  if (fullText.length === 0) return []

  if (headings.length === 0) {
    // No headings — single section
    const wordCount = countWords(fullText)
    return [
      {
        headingLevel: 0,
        title: '(Document)',
        startCharIndex: 0,
        endCharIndex: fullText.length,
        wordCount,
        textContent: fullText,
        paragraphCount: fullText.split('\n').filter((l) => l.trim().length > 0).length,
      },
    ]
  }

  const sections: DocumentSection[] = []

  // Preamble before first heading (if any)
  if (headings[0].charIndex > 0) {
    const preambleText = fullText.slice(0, headings[0].charIndex).trim()
    if (preambleText.length > 0) {
      sections.push({
        headingLevel: 0,
        title: '(Preamble)',
        startCharIndex: 0,
        endCharIndex: headings[0].charIndex,
        wordCount: countWords(preambleText),
        textContent: preambleText,
        paragraphCount: preambleText.split('\n').filter((l) => l.trim().length > 0).length,
      })
    }
  }

  // Sections defined by headings
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    const nextHeadingStart = i + 1 < headings.length ? headings[i + 1].charIndex : fullText.length
    const sectionText = fullText.slice(heading.charIndex, nextHeadingStart).trim()

    sections.push({
      headingLevel: heading.level,
      title: heading.title,
      startCharIndex: heading.charIndex,
      endCharIndex: nextHeadingStart,
      wordCount: countWords(sectionText),
      textContent: sectionText,
      paragraphCount: sectionText.split('\n').filter((l) => l.trim().length > 0).length,
    })
  }

  return sections
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length
}

function buildHeadingHierarchy(sections: DocumentSection[]): string {
  return sections
    .filter((s) => s.headingLevel > 0) // Exclude preamble
    .map((s, i) => `${i + 1}. ${s.title} (${s.wordCount}w)`)
    .join(' / ')
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Extract structured document content from a base64-encoded Yjs state.
 */
export function extractDocumentContent(yjsStateBase64: string): DocumentOutline {
  const doc = new Y.Doc()
  try {
    const stateBuffer = Buffer.from(yjsStateBase64, 'base64')
    Y.applyUpdate(doc, new Uint8Array(stateBuffer))

    const fragment = doc.getXmlFragment('default')
    const result = { text: '', headings: [] as HeadingMark[], paragraphCount: 0 }
    walkNode(fragment, result)

    const fullText = result.text.trim()
    const sections = splitIntoSections(fullText, result.headings)

    return {
      sections,
      totalWordCount: countWords(fullText),
      totalCharCount: fullText.length,
      fullText,
      headingHierarchy: buildHeadingHierarchy(sections),
    }
  } finally {
    doc.destroy()
  }
}

/**
 * Extract content from a Yjs state Uint8Array (from live server or raw buffer).
 */
export function extractFromYjsState(state: Uint8Array): DocumentOutline {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)

    const fragment = doc.getXmlFragment('default')
    const result = { text: '', headings: [] as HeadingMark[], paragraphCount: 0 }
    walkNode(fragment, result)

    const fullText = result.text.trim()
    const sections = splitIntoSections(fullText, result.headings)

    return {
      sections,
      totalWordCount: countWords(fullText),
      totalCharCount: fullText.length,
      fullText,
      headingHierarchy: buildHeadingHierarchy(sections),
    }
  } finally {
    doc.destroy()
  }
}

/**
 * Extract content from a live Yjs server document (freshest state).
 * Returns null if the document is not currently loaded in memory.
 */
export function extractFromLiveDoc(
  workspaceId: string,
  fileId: string
): DocumentOutline | null {
  const docName = `${workspaceId}:${fileId}`
  const state = getDocState(docName)
  if (!state) return null
  return extractFromYjsState(state)
}

/**
 * Extract content from a plain text string (notes, non-Yjs documents).
 * Returns a single-section outline.
 */
export function extractFromPlainText(text: string): DocumentOutline {
  const wordCount = countWords(text)
  return {
    sections: [
      {
        headingLevel: 0,
        title: '(Document)',
        startCharIndex: 0,
        endCharIndex: text.length,
        wordCount,
        textContent: text,
        paragraphCount: text.split('\n').filter((l) => l.trim().length > 0).length,
      },
    ],
    totalWordCount: wordCount,
    totalCharCount: text.length,
    fullText: text,
    headingHierarchy: '',
  }
}

/**
 * High-level extraction: tries live doc, then persisted Yjs state, then plain text.
 * Returns null if no content is available.
 */
export function extractFileContent(
  file: {
    id: string
    workspaceId?: string | null
    metadata?: Record<string, unknown> | null
  }
): DocumentOutline | null {
  // 1. Try live Yjs server (freshest)
  if (file.workspaceId) {
    const live = extractFromLiveDoc(file.workspaceId, file.id)
    if (live && live.fullText.length > 0) return live
  }

  // 2. Try persisted Yjs state
  const yjsState = file.metadata?.yjsState
  if (typeof yjsState === 'string' && yjsState.length > 0) {
    try {
      const outline = extractDocumentContent(yjsState)
      if (outline.fullText.length > 0) return outline
    } catch {
      // Corrupted Yjs state — fall through
    }
  }

  // 3. Try plain text content
  const content = file.metadata?.content
  if (typeof content === 'string' && content.length > 0) {
    return extractFromPlainText(content)
  }

  return null
}
