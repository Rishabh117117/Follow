import { describe, it, expect } from 'vitest'
import {
  parseMarkdown,
  parseCSV,
  csvToSpreadsheetData,
  parseDocxBasic,
  parseXlsxBasic,
  parseNotionMarkdown,
  detectImportType,
  getEditorTypeForImport,
  getMimeTypeForImport,
} from '../index'

describe('Import Services', () => {
  describe('parseMarkdown', () => {
    it('should extract title from first heading', () => {
      const result = parseMarkdown('# My Document\n\nSome content')
      expect(result.title).toBe('My Document')
    })

    it('should extract title from first non-empty line if no heading', () => {
      const result = parseMarkdown('This is just a paragraph')
      expect(result.title).toBe('This is just a paragraph')
    })

    it('should truncate long titles to 50 characters', () => {
      const longLine = 'A'.repeat(100)
      const result = parseMarkdown(longLine)
      expect(result.title.length).toBeLessThanOrEqual(50)
    })

    it('should convert headings to HTML', () => {
      const result = parseMarkdown('# H1\n## H2\n### H3')
      expect(result.html).toContain('<h1>H1</h1>')
      expect(result.html).toContain('<h2>H2</h2>')
      expect(result.html).toContain('<h3>H3</h3>')
    })

    it('should convert bold and italic', () => {
      const result = parseMarkdown('**bold** and *italic* and ***both***')
      expect(result.html).toContain('<strong>bold</strong>')
      expect(result.html).toContain('<em>italic</em>')
      expect(result.html).toContain('<strong><em>both</em></strong>')
    })

    it('should convert inline code', () => {
      const result = parseMarkdown('Use `console.log` for debugging')
      expect(result.html).toContain('<code>console.log</code>')
    })

    it('should convert links', () => {
      const result = parseMarkdown('[Google](https://google.com)')
      expect(result.html).toContain('<a href="https://google.com">Google</a>')
    })

    it('should convert images', () => {
      const result = parseMarkdown('![Alt text](image.png)')
      expect(result.html).toContain('<img src="image.png" alt="Alt text" />')
    })

    it('should convert list items', () => {
      const result = parseMarkdown('- Item 1\n- Item 2')
      expect(result.html).toContain('<li>Item 1</li>')
      expect(result.html).toContain('<li>Item 2</li>')
    })

    it('should convert blockquotes', () => {
      const result = parseMarkdown('> Important note')
      expect(result.html).toContain('<blockquote>Important note</blockquote>')
    })

    it('should convert horizontal rules', () => {
      const result = parseMarkdown('Above\n---\nBelow')
      expect(result.html).toContain('<hr />')
    })

    it('should handle empty content', () => {
      const result = parseMarkdown('')
      expect(result.title).toBe('Untitled')
    })
  })

  describe('parseCSV', () => {
    it('should parse headers and rows', () => {
      const result = parseCSV('Name,Age,City\nAlice,30,NYC\nBob,25,LA')
      expect(result.headers).toEqual(['Name', 'Age', 'City'])
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual(['Alice', '30', 'NYC'])
    })

    it('should handle quoted fields with commas', () => {
      const result = parseCSV('Name,Description\nAlice,"Hello, World"\nBob,Simple')
      expect(result.rows[0]![1]).toBe('Hello, World')
    })

    it('should handle escaped quotes within quoted fields', () => {
      const result = parseCSV('Name,Quote\nAlice,"She said ""hello"""\nBob,Normal')
      expect(result.rows[0]![1]).toBe('She said "hello"')
    })

    it('should return empty for empty content', () => {
      const result = parseCSV('')
      expect(result.headers).toEqual([])
      expect(result.rows).toEqual([])
    })

    it('should skip empty lines', () => {
      const result = parseCSV('A,B\n1,2\n\n3,4\n')
      expect(result.rows).toHaveLength(2)
    })

    it('should handle single column', () => {
      const result = parseCSV('Name\nAlice\nBob')
      expect(result.headers).toEqual(['Name'])
      expect(result.rows).toEqual([['Alice'], ['Bob']])
    })
  })

  describe('csvToSpreadsheetData', () => {
    it('should place headers in row 0 with bold format', () => {
      const cells = csvToSpreadsheetData(['Name', 'Age'], [['Alice', '30']])
      expect(cells['A0']).toEqual({ value: 'Name', format: { bold: true } })
      expect(cells['B0']).toEqual({ value: 'Age', format: { bold: true } })
    })

    it('should place data rows starting from row 1', () => {
      const cells = csvToSpreadsheetData(['Name'], [['Alice'], ['Bob']])
      expect(cells['A1']).toEqual({ value: 'Alice' })
      expect(cells['A2']).toEqual({ value: 'Bob' })
    })

    it('should limit to 26 columns (A-Z)', () => {
      const headers = Array.from({ length: 30 }, (_, i) => `Col${i}`)
      const rows = [Array.from({ length: 30 }, (_, i) => `val${i}`)]
      const cells = csvToSpreadsheetData(headers, rows)
      // Column 26 (index 26, AA) should not be in cells
      expect(cells['A0']).toBeDefined()
      // Check that columns beyond Z are not present for data rows
      const keys = Object.keys(cells)
      const dataKeys = keys.filter((k) => k.endsWith('1'))
      expect(dataKeys.length).toBeLessThanOrEqual(26)
    })

    it('should handle empty data', () => {
      const cells = csvToSpreadsheetData([], [])
      expect(Object.keys(cells)).toHaveLength(0)
    })
  })

  describe('parseDocxBasic', () => {
    it('should extract text from w:t XML tags', () => {
      const xml = '<w:t>Hello</w:t> <w:t>World</w:t>'
      const buffer = new TextEncoder().encode(xml).buffer
      const result = parseDocxBasic(buffer)
      expect(result.html).toContain('Hello World')
    })

    it('should set title from first 50 chars of content', () => {
      const xml = '<w:t>My Important Document About Finance</w:t>'
      const buffer = new TextEncoder().encode(xml).buffer
      const result = parseDocxBasic(buffer)
      expect(result.title).toBe('My Important Document About Finance')
    })

    it('should return default title when no text found', () => {
      const xml = '<root>no w:t tags here</root>'
      const buffer = new TextEncoder().encode(xml).buffer
      const result = parseDocxBasic(buffer)
      expect(result.title).toBe('Imported Document')
    })
  })

  describe('parseXlsxBasic', () => {
    it('should parse CSV fallback content into cells', () => {
      const result = parseXlsxBasic('Name,Age\nAlice,30\nBob,25')
      expect(result.cells['A0']).toEqual({ value: 'Name' })
      expect(result.cells['B0']).toEqual({ value: 'Age' })
      expect(result.cells['A1']).toEqual({ value: 'Alice' })
      expect(result.rowCount).toBe(3)
      expect(result.colCount).toBe(2)
    })

    it('should handle empty content', () => {
      const result = parseXlsxBasic('')
      expect(result.rowCount).toBe(1)
      expect(result.colCount).toBe(0)
    })
  })

  describe('parseNotionMarkdown', () => {
    it('should convert Notion callout syntax to callout divs', () => {
      const result = parseNotionMarkdown('> 💡 This is a tip')
      expect(result.html).toContain('<div class="callout">This is a tip</div>')
    })

    it('should still parse regular markdown', () => {
      const result = parseNotionMarkdown('# Title\n**Bold** text')
      expect(result.title).toBe('Title')
      expect(result.html).toContain('<strong>Bold</strong>')
    })
  })

  describe('detectImportType', () => {
    it('should detect markdown files', () => {
      expect(detectImportType('notes.md', '')).toBe('markdown')
      expect(detectImportType('readme.markdown', '')).toBe('markdown')
    })

    it('should detect CSV files', () => {
      expect(detectImportType('data.csv', '')).toBe('csv')
    })

    it('should detect XLSX files', () => {
      expect(detectImportType('sheet.xlsx', '')).toBe('xlsx')
      expect(detectImportType('old.xls', '')).toBe('xlsx')
    })

    it('should detect DOCX files', () => {
      expect(detectImportType('document.docx', '')).toBe('docx')
      expect(detectImportType('old.doc', '')).toBe('docx')
    })

    it('should detect Notion exports by zip extension', () => {
      expect(detectImportType('export.zip', '')).toBe('notion_export')
    })

    it('should fall back to MIME type when extension is unknown', () => {
      expect(detectImportType('file.unknown', 'text/markdown')).toBe('markdown')
      expect(detectImportType('file.unknown', 'text/csv')).toBe('csv')
      expect(detectImportType('file.unknown', 'application/vnd.ms-excel')).toBe('xlsx')
      expect(detectImportType('file.unknown', 'application/msword')).toBe('docx')
    })

    it('should return "unknown" for unrecognized formats', () => {
      expect(detectImportType('file.xyz', 'application/octet-stream')).toBe('unknown')
    })
  })

  describe('getEditorTypeForImport', () => {
    it('should map markdown to note editor', () => {
      expect(getEditorTypeForImport('markdown')).toBe('note')
    })

    it('should map csv and xlsx to spreadsheet editor', () => {
      expect(getEditorTypeForImport('csv')).toBe('spreadsheet')
      expect(getEditorTypeForImport('xlsx')).toBe('spreadsheet')
    })

    it('should map docx to document editor', () => {
      expect(getEditorTypeForImport('docx')).toBe('document')
    })

    it('should map notion_export to note editor', () => {
      expect(getEditorTypeForImport('notion_export')).toBe('note')
    })

    it('should default to document for unknown types', () => {
      expect(getEditorTypeForImport('unknown')).toBe('document')
    })
  })

  describe('getMimeTypeForImport', () => {
    it('should return correct MIME types', () => {
      expect(getMimeTypeForImport('markdown')).toBe('text/markdown')
      expect(getMimeTypeForImport('csv')).toBe('text/csv')
      expect(getMimeTypeForImport('xlsx')).toContain('spreadsheetml')
      expect(getMimeTypeForImport('docx')).toContain('wordprocessingml')
      expect(getMimeTypeForImport('notion_export')).toBe('text/markdown')
    })

    it('should return octet-stream for unknown types', () => {
      expect(getMimeTypeForImport('unknown')).toBe('application/octet-stream')
    })
  })
})
