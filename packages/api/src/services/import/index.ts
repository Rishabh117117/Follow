/**
 * Import services — handle importing documents from various formats.
 *
 * Supported:
 *   - Markdown (.md)     → Notes editor
 *   - CSV (.csv)         → Spreadsheet editor
 *   - XLSX (.xlsx)       → Spreadsheet editor
 *   - DOCX (.docx)       → Rich text editor (via mammoth)
 *   - Notion export (.zip of .md) → Multiple documents
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface ImportResult {
  success: boolean
  fileId?: string
  fileName: string
  editorType: string
  error?: string
}

export interface ImportOptions {
  workspaceId: string
  parentFolderId?: string
  createdBy: string
}

// ─── Markdown Import ──────────────────────────────────────────────────

export function parseMarkdown(content: string): {
  title: string
  html: string
} {
  // Extract title from first heading or first line
  const lines = content.split('\n')
  let title = 'Untitled'

  for (const line of lines) {
    const match = line.match(/^#+\s+(.+)/)
    if (match) {
      title = match[1]!.trim()
      break
    }
    if (line.trim().length > 0) {
      title = line.trim().slice(0, 50)
      break
    }
  }

  // Convert markdown to basic HTML
  let html = content
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Images (must be before links since ![text](url) contains [text](url))
    .replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" />')
    // Links
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    // Lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr />')
    // Line breaks to paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />')

  html = `<p>${html}</p>`

  return { title, html }
}

// ─── CSV Import ───────────────────────────────────────────────────────

export function parseCSV(content: string): {
  headers: string[]
  rows: string[][]
} {
  const lines = content.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const parseLine = (line: string): string[] => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    cells.push(current.trim())
    return cells
  }

  const headers = parseLine(lines[0]!)
  const rows = lines.slice(1).map(parseLine)

  return { headers, rows }
}

/**
 * Convert parsed CSV to spreadsheet data format.
 */
export function csvToSpreadsheetData(
  headers: string[],
  rows: string[][]
): Record<string, { value: string; format?: Record<string, unknown> }> {
  const cells: Record<string, { value: string; format?: Record<string, unknown> }> = {}

  // Headers in row 0
  headers.forEach((header, col) => {
    const colLetter = String.fromCharCode(65 + col)
    cells[`${colLetter}0`] = { value: header, format: { bold: true } }
  })

  // Data rows
  rows.forEach((row, rowIdx) => {
    row.forEach((cell, col) => {
      if (col < 26) {
        // Max 26 columns
        const colLetter = String.fromCharCode(65 + col)
        cells[`${colLetter}${rowIdx + 1}`] = { value: cell }
      }
    })
  })

  return cells
}

// ─── DOCX Import (basic) ─────────────────────────────────────────────

/**
 * Extract text content from a DOCX buffer (simplified parser).
 * For full DOCX support, use the mammoth library in production.
 */
export function parseDocxBasic(buffer: ArrayBuffer): { title: string; html: string } {
  // DOCX is a ZIP containing XML files.
  // This is a simplified extraction — in production, use mammoth library.
  const decoder = new TextDecoder()
  const raw = decoder.decode(buffer)

  // Try to extract text between XML text tags
  const textMatches = raw.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) ?? []
  const texts = textMatches.map((m) => m.replace(/<[^>]+>/g, ''))

  const content = texts.join(' ')
  const title = content.slice(0, 50).trim() || 'Imported Document'

  return {
    title,
    html: `<p>${content.replace(/\n/g, '</p><p>')}</p>`,
  }
}

// ─── XLSX Import (basic) ─────────────────────────────────────────────

/**
 * Parse a basic XLSX-like structure.
 * For full XLSX support, use the xlsx (SheetJS) library in production.
 */
export function parseXlsxBasic(csvFallback: string): {
  cells: Record<string, { value: string }>
  rowCount: number
  colCount: number
} {
  const { headers, rows } = parseCSV(csvFallback)
  const cells: Record<string, { value: string }> = {}

  headers.forEach((header, col) => {
    const colLetter = String.fromCharCode(65 + col)
    cells[`${colLetter}0`] = { value: header }
  })

  rows.forEach((row, rowIdx) => {
    row.forEach((cell, col) => {
      if (col < 26) {
        const colLetter = String.fromCharCode(65 + col)
        cells[`${colLetter}${rowIdx + 1}`] = { value: cell }
      }
    })
  })

  return {
    cells,
    rowCount: rows.length + 1,
    colCount: headers.length,
  }
}

// ─── Notion Import ───────────────────────────────────────────────────

/**
 * Parse Notion-specific markdown extensions.
 */
export function parseNotionMarkdown(content: string): {
  title: string
  html: string
} {
  // Handle Notion callouts: > ℹ️ text → callout block
  const processed = content
    .replace(/^> [\p{Emoji}\uFE0F]+\s*(.+)$/gmu, '<div class="callout">$1</div>')
    // Handle Notion toggles: > text (simplify to blockquote)
    .replace(
      /^<details>\s*<summary>(.+)<\/summary>([\s\S]*?)<\/details>/gm,
      '<blockquote><strong>$1</strong>$2</blockquote>'
    )

  return parseMarkdown(processed)
}

// ─── Import Orchestrator ──────────────────────────────────────────────

export interface FileImportData {
  name: string
  content: string | ArrayBuffer
  mimeType: string
}

export function detectImportType(fileName: string, mimeType: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''

  switch (ext) {
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'csv':
      return 'csv'
    case 'xlsx':
    case 'xls':
      return 'xlsx'
    case 'docx':
    case 'doc':
      return 'docx'
    case 'zip':
      return 'notion_export'
    default:
      if (mimeType.includes('markdown') || mimeType.includes('text/plain')) return 'markdown'
      if (mimeType.includes('csv')) return 'csv'
      if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'xlsx'
      if (mimeType.includes('word') || mimeType.includes('document')) return 'docx'
      return 'unknown'
  }
}

export function getEditorTypeForImport(importType: string): string {
  switch (importType) {
    case 'markdown':
      return 'note'
    case 'csv':
    case 'xlsx':
      return 'spreadsheet'
    case 'docx':
      return 'document'
    case 'notion_export':
      return 'note'
    default:
      return 'document'
  }
}

export function getMimeTypeForImport(importType: string): string {
  switch (importType) {
    case 'markdown':
    case 'notion_export':
      return 'text/markdown'
    case 'csv':
      return 'text/csv'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    default:
      return 'application/octet-stream'
  }
}
