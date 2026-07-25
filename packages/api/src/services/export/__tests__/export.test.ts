import { describe, it, expect } from 'vitest'
import {
  htmlToMarkdown,
  spreadsheetToCSV,
  canvasToSVG,
  canvasToJSON,
  wrapHTMLForExport,
  getExportFormats,
  getExportMimeType,
} from '../index'

describe('Export Services', () => {
  describe('htmlToMarkdown', () => {
    it('should convert headings', () => {
      expect(htmlToMarkdown('<h1>Title</h1>')).toContain('# Title')
      expect(htmlToMarkdown('<h2>Subtitle</h2>')).toContain('## Subtitle')
      expect(htmlToMarkdown('<h3>Section</h3>')).toContain('### Section')
      expect(htmlToMarkdown('<h4>Subsection</h4>')).toContain('#### Subsection')
    })

    it('should convert bold and italic', () => {
      expect(htmlToMarkdown('<strong>bold</strong>')).toContain('**bold**')
      expect(htmlToMarkdown('<b>bold</b>')).toContain('**bold**')
      expect(htmlToMarkdown('<em>italic</em>')).toContain('*italic*')
      expect(htmlToMarkdown('<i>italic</i>')).toContain('*italic*')
    })

    it('should convert strikethrough', () => {
      expect(htmlToMarkdown('<s>deleted</s>')).toContain('~~deleted~~')
    })

    it('should convert inline code', () => {
      expect(htmlToMarkdown('<code>console.log</code>')).toContain('`console.log`')
    })

    it('should convert links', () => {
      const result = htmlToMarkdown('<a href="https://example.com">Link</a>')
      expect(result).toContain('[Link](https://example.com)')
    })

    it('should convert images', () => {
      const result = htmlToMarkdown('<img src="photo.jpg" alt="A photo" />')
      expect(result).toContain('![A photo](photo.jpg)')
    })

    it('should convert code blocks with language', () => {
      const result = htmlToMarkdown('<pre><code class="language-js">const x = 1;</code></pre>')
      expect(result).toContain('```js')
      expect(result).toContain('const x = 1;')
    })

    it('should convert code blocks without language', () => {
      const result = htmlToMarkdown('<pre><code>plain code</code></pre>')
      expect(result).toContain('```')
      expect(result).toContain('plain code')
    })

    it('should convert list items', () => {
      const result = htmlToMarkdown('<li>Item one</li><li>Item two</li>')
      expect(result).toContain('- Item one')
      expect(result).toContain('- Item two')
    })

    it('should convert blockquotes', () => {
      const result = htmlToMarkdown('<blockquote>A wise quote</blockquote>')
      expect(result).toContain('> A wise quote')
    })

    it('should convert horizontal rules', () => {
      const result = htmlToMarkdown('<hr />')
      expect(result).toContain('---')
    })

    it('should convert line breaks', () => {
      const result = htmlToMarkdown('Line 1<br />Line 2')
      expect(result).toContain('Line 1\nLine 2')
    })

    it('should convert paragraphs', () => {
      const result = htmlToMarkdown('<p>First paragraph</p><p>Second paragraph</p>')
      expect(result).toContain('First paragraph')
      expect(result).toContain('Second paragraph')
    })

    it('should convert task lists', () => {
      const checked = htmlToMarkdown('<input checked type="checkbox" />')
      expect(checked).toContain('- [x]')
      const unchecked = htmlToMarkdown('<input type="checkbox" />')
      expect(unchecked).toContain('- [ ]')
    })

    it('should decode HTML entities', () => {
      const result = htmlToMarkdown('&amp; &lt; &gt; &quot; &#39;')
      expect(result).toContain('&')
      expect(result).toContain('<')
      expect(result).toContain('>')
      expect(result).toContain('"')
      expect(result).toContain("'")
    })

    it('should strip remaining HTML tags', () => {
      const result = htmlToMarkdown('<div><span>Hello</span></div>')
      expect(result).not.toContain('<div>')
      expect(result).not.toContain('<span>')
      expect(result).toContain('Hello')
    })

    it('should trim and clean excessive newlines', () => {
      const result = htmlToMarkdown('<p>A</p>\n\n\n\n<p>B</p>')
      // Should collapse multiple newlines to max 2
      expect(result.includes('\n\n\n')).toBe(false)
    })
  })

  describe('spreadsheetToCSV', () => {
    it('should convert cells to CSV format', () => {
      const cells: Record<string, { value: string }> = {
        A0: { value: 'Name' },
        B0: { value: 'Age' },
        A1: { value: 'Alice' },
        B1: { value: '30' },
      }

      const result = spreadsheetToCSV(cells, 2, 2)
      const lines = result.split('\n')
      expect(lines[0]).toBe('Name,Age')
      expect(lines[1]).toBe('Alice,30')
    })

    it('should escape values containing commas', () => {
      const cells: Record<string, { value: string }> = {
        A0: { value: 'Hello, World' },
      }

      const result = spreadsheetToCSV(cells, 1, 1)
      expect(result).toContain('"Hello, World"')
    })

    it('should escape values containing double quotes', () => {
      const cells: Record<string, { value: string }> = {
        A0: { value: 'She said "hello"' },
      }

      const result = spreadsheetToCSV(cells, 1, 1)
      expect(result).toContain('"She said ""hello"""')
    })

    it('should escape values containing newlines', () => {
      const cells: Record<string, { value: string }> = {
        A0: { value: 'Line1\nLine2' },
      }

      const result = spreadsheetToCSV(cells, 1, 1)
      expect(result).toContain('"Line1\nLine2"')
    })

    it('should skip empty rows', () => {
      const cells: Record<string, { value: string }> = {
        A0: { value: 'Data' },
        // Row 1 is empty
        A2: { value: 'More' },
      }

      const result = spreadsheetToCSV(cells, 3, 1)
      const lines = result.split('\n')
      expect(lines).toHaveLength(2) // Only rows with data
    })

    it('should handle empty cells object', () => {
      const result = spreadsheetToCSV({}, 5, 5)
      expect(result).toBe('')
    })
  })

  describe('canvasToSVG', () => {
    it('should generate empty SVG for no objects', () => {
      const result = canvasToSVG([])
      expect(result).toContain('<svg')
      expect(result).toContain('width="800"')
      expect(result).toContain('height="600"')
    })

    it('should generate rect elements for rectangles', () => {
      const result = canvasToSVG([{ type: 'rectangle', x: 10, y: 20, width: 100, height: 50 }])
      expect(result).toContain('<rect')
      expect(result).toContain('width="100"')
      expect(result).toContain('height="50"')
    })

    it('should generate ellipse elements for circles', () => {
      const result = canvasToSVG([{ type: 'circle', x: 0, y: 0, width: 100, height: 100 }])
      expect(result).toContain('<ellipse')
      expect(result).toContain('rx="50"')
      expect(result).toContain('ry="50"')
    })

    it('should generate polygon elements for diamonds', () => {
      const result = canvasToSVG([{ type: 'diamond', x: 0, y: 0, width: 100, height: 100 }])
      expect(result).toContain('<polygon')
    })

    it('should generate text elements', () => {
      const result = canvasToSVG([
        { type: 'text', x: 10, y: 20, width: 200, height: 30, text: 'Hello World' },
      ])
      expect(result).toContain('<text')
      expect(result).toContain('Hello World')
    })

    it('should escape XML special characters in text', () => {
      const result = canvasToSVG([
        { type: 'text', x: 0, y: 0, width: 100, height: 30, text: '<script>alert("hi")</script>' },
      ])
      expect(result).toContain('&lt;script&gt;')
      expect(result).not.toContain('<script>')
    })

    it('should generate path elements for freehand', () => {
      const result = canvasToSVG([
        {
          type: 'freehand',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 50 },
            { x: 100, y: 0 },
          ],
        },
      ])
      expect(result).toContain('<path')
      expect(result).toContain('M')
      expect(result).toContain('L')
    })

    it('should generate line elements', () => {
      const result = canvasToSVG([{ type: 'line', x: 10, y: 20, width: 200, height: 100 }])
      expect(result).toContain('<line')
    })

    it('should apply custom styles', () => {
      const result = canvasToSVG([
        {
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          style: {
            fillColor: '#ff0000',
            strokeColor: '#00ff00',
            strokeWidth: 3,
            opacity: 0.8,
          },
        },
      ])
      expect(result).toContain('fill="#ff0000"')
      expect(result).toContain('stroke="#00ff00"')
      expect(result).toContain('stroke-width="3"')
      expect(result).toContain('opacity="0.8"')
    })

    it('should render sticky notes as rectangles', () => {
      const result = canvasToSVG([{ type: 'sticky-note', x: 0, y: 0, width: 100, height: 100 }])
      expect(result).toContain('<rect')
    })

    it('should include white background and viewBox', () => {
      const result = canvasToSVG([{ type: 'rectangle', x: 0, y: 0, width: 100, height: 100 }])
      expect(result).toContain('fill="white"')
      expect(result).toContain('viewBox=')
    })
  })

  describe('canvasToJSON', () => {
    it('should include version, timestamp, and objects', () => {
      const result = JSON.parse(canvasToJSON([{ id: '1', type: 'rect' }]))
      expect(result.version).toBe('1.0')
      expect(result.exportedAt).toBeDefined()
      expect(result.objects).toHaveLength(1)
    })

    it('should include metadata when provided', () => {
      const result = JSON.parse(canvasToJSON([], { canvasName: 'My Canvas' }))
      expect(result.metadata.canvasName).toBe('My Canvas')
    })

    it('should return pretty-printed JSON', () => {
      const result = canvasToJSON([])
      expect(result).toContain('\n') // Pretty printed
    })

    it('should handle empty objects', () => {
      const result = JSON.parse(canvasToJSON([]))
      expect(result.objects).toEqual([])
      expect(result.metadata).toEqual({})
    })
  })

  describe('wrapHTMLForExport', () => {
    it('should include the title in the head', () => {
      const result = wrapHTMLForExport('<p>Content</p>', 'My Document')
      expect(result).toContain('<title>My Document</title>')
    })

    it('should include the HTML body content', () => {
      const result = wrapHTMLForExport('<h1>Hello</h1>', 'Test')
      expect(result).toContain('<h1>Hello</h1>')
    })

    it('should include DOCTYPE and basic document structure', () => {
      const result = wrapHTMLForExport('', 'Test')
      expect(result).toContain('<!DOCTYPE html>')
      expect(result).toContain('<html')
      expect(result).toContain('</html>')
      expect(result).toContain('<head>')
      expect(result).toContain('<body>')
    })

    it('should include styling', () => {
      const result = wrapHTMLForExport('', 'Test')
      expect(result).toContain('<style>')
      expect(result).toContain('font-family')
    })

    it('should escape XML entities in title', () => {
      const result = wrapHTMLForExport('', 'Title & <Special>')
      expect(result).toContain('Title &amp; &lt;Special&gt;')
    })
  })

  describe('getExportFormats', () => {
    it('should return correct formats for documents', () => {
      const formats = getExportFormats('document')
      expect(formats).toContain('pdf')
      expect(formats).toContain('docx')
      expect(formats).toContain('markdown')
      expect(formats).toContain('html')
    })

    it('should return correct formats for notes', () => {
      const formats = getExportFormats('note')
      expect(formats).toContain('markdown')
      expect(formats).toContain('html')
      expect(formats).toContain('pdf')
    })

    it('should return correct formats for spreadsheets', () => {
      const formats = getExportFormats('spreadsheet')
      expect(formats).toContain('csv')
      expect(formats).toContain('xlsx')
    })

    it('should return correct formats for presentations', () => {
      const formats = getExportFormats('presentation')
      expect(formats).toContain('pptx')
      expect(formats).toContain('pdf')
    })

    it('should return correct formats for canvas', () => {
      const formats = getExportFormats('canvas')
      expect(formats).toContain('png')
      expect(formats).toContain('svg')
      expect(formats).toContain('json')
    })

    it('should default to HTML for unknown types', () => {
      expect(getExportFormats('unknown')).toEqual(['html'])
    })
  })

  describe('getExportMimeType', () => {
    it('should return correct MIME types', () => {
      expect(getExportMimeType('pdf')).toBe('application/pdf')
      expect(getExportMimeType('csv')).toBe('text/csv')
      expect(getExportMimeType('markdown')).toBe('text/markdown')
      expect(getExportMimeType('html')).toBe('text/html')
      expect(getExportMimeType('svg')).toBe('image/svg+xml')
      expect(getExportMimeType('png')).toBe('image/png')
      expect(getExportMimeType('json')).toBe('application/json')
    })

    it('should return OOXML types for office formats', () => {
      expect(getExportMimeType('docx')).toContain('wordprocessingml')
      expect(getExportMimeType('xlsx')).toContain('spreadsheetml')
      expect(getExportMimeType('pptx')).toContain('presentationml')
    })

    it('should return octet-stream for unknown formats', () => {
      expect(getExportMimeType('xyz')).toBe('application/octet-stream')
    })
  })
})
