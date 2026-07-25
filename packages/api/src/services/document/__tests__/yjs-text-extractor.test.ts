import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  extractDocumentContent,
  extractFromYjsState,
  extractFromPlainText,
  extractFileContent,
} from '../yjs-text-extractor'

// Helper: create a Y.Doc with TipTap-like structure and return base64 state
function createTestDoc(builder: (fragment: Y.XmlFragment) => void): string {
  const doc = new Y.Doc()
  const fragment = doc.getXmlFragment('default')
  builder(fragment)
  const state = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return Buffer.from(state).toString('base64')
}

// Helper: add a paragraph element
function addParagraph(parent: Y.XmlFragment | Y.XmlElement, text: string): void {
  const p = new Y.XmlElement('paragraph')
  const textNode = new Y.XmlText()
  textNode.insert(0, text)
  p.insert(0, [textNode])
  parent.insert(parent.length, [p])
}

// Helper: add a heading element
function addHeading(
  parent: Y.XmlFragment | Y.XmlElement,
  text: string,
  level: number
): void {
  const h = new Y.XmlElement('heading')
  h.setAttribute('level', level)
  const textNode = new Y.XmlText()
  textNode.insert(0, text)
  h.insert(0, [textNode])
  parent.insert(parent.length, [h])
}

describe('yjs-text-extractor', () => {
  describe('extractDocumentContent', () => {
    it('extracts text from empty document', () => {
      const base64 = createTestDoc(() => {
        // Empty fragment
      })
      const outline = extractDocumentContent(base64)
      expect(outline.fullText).toBe('')
      expect(outline.totalWordCount).toBe(0)
      expect(outline.sections).toHaveLength(0)
    })

    it('extracts text from a single paragraph', () => {
      const base64 = createTestDoc((fragment) => {
        addParagraph(fragment, 'Hello world, this is a test document.')
      })
      const outline = extractDocumentContent(base64)
      expect(outline.fullText).toBe('Hello world, this is a test document.')
      expect(outline.totalWordCount).toBe(7)
      expect(outline.sections).toHaveLength(1)
      expect(outline.sections[0].title).toBe('(Document)')
      expect(outline.sections[0].headingLevel).toBe(0)
    })

    it('extracts text with H1 headings as sections', () => {
      const base64 = createTestDoc((fragment) => {
        addHeading(fragment, 'Introduction', 1)
        addParagraph(fragment, 'This is the introduction paragraph.')
        addHeading(fragment, 'Methods', 1)
        addParagraph(fragment, 'This is the methods paragraph with more words added.')
      })
      const outline = extractDocumentContent(base64)
      expect(outline.sections).toHaveLength(2)
      expect(outline.sections[0].title).toBe('Introduction')
      expect(outline.sections[0].headingLevel).toBe(1)
      expect(outline.sections[1].title).toBe('Methods')
      expect(outline.sections[1].headingLevel).toBe(1)
    })

    it('handles mixed heading levels (H1, H2, H3)', () => {
      const base64 = createTestDoc((fragment) => {
        addHeading(fragment, 'Chapter One', 1)
        addParagraph(fragment, 'Intro text.')
        addHeading(fragment, 'Background', 2)
        addParagraph(fragment, 'Background text.')
        addHeading(fragment, 'Details', 3)
        addParagraph(fragment, 'Details text.')
      })
      const outline = extractDocumentContent(base64)
      expect(outline.sections).toHaveLength(3)
      expect(outline.sections[0].headingLevel).toBe(1)
      expect(outline.sections[1].headingLevel).toBe(2)
      expect(outline.sections[2].headingLevel).toBe(3)
    })

    it('creates preamble section for text before first heading', () => {
      const base64 = createTestDoc((fragment) => {
        addParagraph(fragment, 'Some preamble text before any heading.')
        addHeading(fragment, 'First Section', 1)
        addParagraph(fragment, 'Section content.')
      })
      const outline = extractDocumentContent(base64)
      expect(outline.sections).toHaveLength(2)
      expect(outline.sections[0].title).toBe('(Preamble)')
      expect(outline.sections[0].headingLevel).toBe(0)
      expect(outline.sections[1].title).toBe('First Section')
    })

    it('calculates word count per section', () => {
      const base64 = createTestDoc((fragment) => {
        addHeading(fragment, 'Short Section', 1)
        addParagraph(fragment, 'One two three.')
        addHeading(fragment, 'Long Section', 1)
        addParagraph(fragment, 'One two three four five six seven eight nine ten.')
      })
      const outline = extractDocumentContent(base64)
      // Short section: "Short Section" (2) + "One two three." (3) = 5 words
      expect(outline.sections[0].wordCount).toBeGreaterThanOrEqual(3)
      // Long section has more words
      expect(outline.sections[1].wordCount).toBeGreaterThan(outline.sections[0].wordCount)
    })

    it('calculates total word count', () => {
      const base64 = createTestDoc((fragment) => {
        addParagraph(fragment, 'one two three four')
        addParagraph(fragment, 'five six seven')
      })
      const outline = extractDocumentContent(base64)
      expect(outline.totalWordCount).toBe(7)
    })

    it('builds heading hierarchy string', () => {
      const base64 = createTestDoc((fragment) => {
        addHeading(fragment, 'Intro', 1)
        addParagraph(fragment, 'Text here.')
        addHeading(fragment, 'Methods', 1)
        addParagraph(fragment, 'More text here.')
      })
      const outline = extractDocumentContent(base64)
      expect(outline.headingHierarchy).toContain('Intro')
      expect(outline.headingHierarchy).toContain('Methods')
      expect(outline.headingHierarchy).toContain('w)')
    })

    it('handles bullet lists', () => {
      const base64 = createTestDoc((fragment) => {
        const list = new Y.XmlElement('bulletList')
        const item1 = new Y.XmlElement('listItem')
        addParagraph(item1, 'First item')
        list.insert(0, [item1])
        const item2 = new Y.XmlElement('listItem')
        addParagraph(item2, 'Second item')
        list.insert(1, [item2])
        fragment.insert(0, [list])
      })
      const outline = extractDocumentContent(base64)
      expect(outline.fullText).toContain('First item')
      expect(outline.fullText).toContain('Second item')
    })

    it('handles code blocks', () => {
      const base64 = createTestDoc((fragment) => {
        const code = new Y.XmlElement('codeBlock')
        const textNode = new Y.XmlText()
        textNode.insert(0, 'const x = 42;')
        code.insert(0, [textNode])
        fragment.insert(0, [code])
      })
      const outline = extractDocumentContent(base64)
      expect(outline.fullText).toContain('const x = 42;')
    })

    it('handles multiple paragraphs', () => {
      const base64 = createTestDoc((fragment) => {
        addParagraph(fragment, 'Paragraph one.')
        addParagraph(fragment, 'Paragraph two.')
        addParagraph(fragment, 'Paragraph three.')
      })
      const outline = extractDocumentContent(base64)
      expect(outline.fullText).toContain('Paragraph one.')
      expect(outline.fullText).toContain('Paragraph two.')
      expect(outline.fullText).toContain('Paragraph three.')
    })
  })

  describe('extractFromYjsState', () => {
    it('extracts from raw Uint8Array state', () => {
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')
      addParagraph(fragment, 'Raw state test.')
      const state = Y.encodeStateAsUpdate(doc)
      doc.destroy()

      const outline = extractFromYjsState(state)
      expect(outline.fullText).toBe('Raw state test.')
      expect(outline.totalWordCount).toBe(3)
    })
  })

  describe('extractFromPlainText', () => {
    it('wraps plain text in a single section', () => {
      const outline = extractFromPlainText('This is plain text content.')
      expect(outline.sections).toHaveLength(1)
      expect(outline.sections[0].title).toBe('(Document)')
      expect(outline.sections[0].headingLevel).toBe(0)
      expect(outline.fullText).toBe('This is plain text content.')
      expect(outline.totalWordCount).toBe(5)
    })

    it('handles empty text', () => {
      const outline = extractFromPlainText('')
      expect(outline.sections).toHaveLength(1)
      expect(outline.totalWordCount).toBe(0)
      expect(outline.totalCharCount).toBe(0)
    })
  })

  describe('extractFileContent', () => {
    it('returns null when no content is available', () => {
      const result = extractFileContent({ id: 'test', metadata: {} })
      expect(result).toBeNull()
    })

    it('extracts from metadata.content (plain text)', () => {
      const result = extractFileContent({
        id: 'test',
        metadata: { content: 'Plain text note content.' },
      })
      expect(result).not.toBeNull()
      expect(result!.fullText).toBe('Plain text note content.')
    })

    it('extracts from metadata.yjsState (base64)', () => {
      const base64 = createTestDoc((fragment) => {
        addParagraph(fragment, 'Yjs persisted content.')
      })
      const result = extractFileContent({
        id: 'test',
        metadata: { yjsState: base64 },
      })
      expect(result).not.toBeNull()
      expect(result!.fullText).toBe('Yjs persisted content.')
    })

    it('handles corrupted yjsState gracefully', () => {
      const result = extractFileContent({
        id: 'test',
        metadata: { yjsState: 'not-valid-base64-yjs-state!!!' },
      })
      // Should fall through to null (no plain text fallback)
      expect(result).toBeNull()
    })

    it('falls back from corrupted yjsState to plain text', () => {
      const result = extractFileContent({
        id: 'test',
        metadata: {
          yjsState: 'corrupted!!!',
          content: 'Fallback plain text.',
        },
      })
      expect(result).not.toBeNull()
      expect(result!.fullText).toBe('Fallback plain text.')
    })

    it('returns null for empty metadata', () => {
      const result = extractFileContent({ id: 'test', metadata: null })
      expect(result).toBeNull()
    })
  })
})
