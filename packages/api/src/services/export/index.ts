/**
 * Export services — handle exporting workspace documents to various formats.
 *
 * Supported:
 *   - Documents: PDF, DOCX, Markdown, HTML
 *   - Spreadsheets: CSV, XLSX
 *   - Presentations: PPTX (uses pptxgenjs)
 *   - Canvas: PNG, SVG, JSON
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface ExportResult {
  data: string | ArrayBuffer
  mimeType: string
  fileName: string
}

// ─── HTML to Markdown ─────────────────────────────────────────────────

export function htmlToMarkdown(html: string): string {
  const md = html
    // Headers
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
    // Text formatting
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u>(.*?)<\/u>/gi, '$1')
    .replace(/<s>(.*?)<\/s>/gi, '~~$1~~')
    // Code blocks (must be before inline code)
    .replace(
      /<pre><code[^>]*class="language-(\w+)"[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
      '```$1\n$2```\n\n'
    )
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1```\n\n')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    // Links and images
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
    // Lists
    .replace(/<li>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<[ou]l[^>]*>/gi, '\n')
    .replace(/<\/[ou]l>/gi, '\n')
    // Blockquotes
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n\n')
    // Horizontal rules
    .replace(/<hr\s*\/?>/gi, '\n---\n\n')
    // Paragraphs and line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    // Task lists
    .replace(/<input[^>]*checked[^>]*type="checkbox"[^>]*>/gi, '- [x] ')
    .replace(/<input[^>]*type="checkbox"[^>]*>/gi, '- [ ] ')
    // Clean remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return md
}

// ─── Spreadsheet to CSV ──────────────────────────────────────────────

export function spreadsheetToCSV(
  cells: Record<string, { value: string; format?: Record<string, unknown> }>,
  rowCount: number = 100,
  colCount: number = 26
): string {
  const rows: string[] = []

  for (let row = 0; row < rowCount; row++) {
    const rowCells: string[] = []
    let hasData = false

    for (let col = 0; col < colCount; col++) {
      const colLetter = String.fromCharCode(65 + col)
      const cell = cells[`${colLetter}${row}`]
      const value = cell?.value ?? ''
      if (value) hasData = true

      // Escape CSV values
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        rowCells.push(`"${value.replace(/"/g, '""')}"`)
      } else {
        rowCells.push(value)
      }
    }

    if (hasData) rows.push(rowCells.join(','))
  }

  return rows.join('\n')
}

// ─── Canvas to SVG ───────────────────────────────────────────────────

export function canvasToSVG(
  objects: Array<{
    type: string
    x: number
    y: number
    width: number
    height: number
    style?: {
      fillColor?: string
      strokeColor?: string
      strokeWidth?: number
      opacity?: number
    }
    text?: string
    points?: Array<{ x: number; y: number }>
    data?: Record<string, unknown>
  }>
): string {
  if (objects.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"></svg>'
  }

  // Calculate bounds
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const obj of objects) {
    minX = Math.min(minX, obj.x)
    minY = Math.min(minY, obj.y)
    maxX = Math.max(maxX, obj.x + obj.width)
    maxY = Math.max(maxY, obj.y + obj.height)
  }

  const padding = 50
  const width = maxX - minX + padding * 2
  const height = maxY - minY + padding * 2

  const elements = objects.map((obj) => {
    const x = obj.x - minX + padding
    const y = obj.y - minY + padding
    const fill = obj.style?.fillColor ?? 'transparent'
    const stroke = obj.style?.strokeColor ?? '#333'
    const strokeWidth = obj.style?.strokeWidth ?? 2
    const opacity = obj.style?.opacity ?? 1

    switch (obj.type) {
      case 'rectangle':
      case 'sticky-note':
        return `<rect x="${x}" y="${y}" width="${obj.width}" height="${obj.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" rx="4" />`

      case 'circle':
        return `<ellipse cx="${x + obj.width / 2}" cy="${y + obj.height / 2}" rx="${obj.width / 2}" ry="${obj.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`

      case 'diamond': {
        const cx = x + obj.width / 2
        const cy = y + obj.height / 2
        return `<polygon points="${cx},${y} ${x + obj.width},${cy} ${cx},${y + obj.height} ${x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`
      }

      case 'text':
        return `<text x="${x}" y="${y + 20}" fill="${stroke}" font-size="16" opacity="${opacity}">${escapeXml(obj.text ?? '')}</text>`

      case 'freehand':
        if (obj.points && obj.points.length > 0) {
          const d = obj.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - minX + padding} ${p.y - minY + padding}`)
            .join(' ')
          return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`
        }
        return ''

      case 'line':
        return `<line x1="${x}" y1="${y}" x2="${x + obj.width}" y2="${y + obj.height}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`

      case 'rich-text': {
        const plainText = (obj.data?.plainText as string) ?? obj.text ?? ''
        const lines = plainText.split('\n').slice(0, 20)
        const textEls = lines
          .map(
            (line, i) => `<tspan x="${x + 12}" dy="${i === 0 ? 0 : 18}">${escapeXml(line)}</tspan>`
          )
          .join('')
        return `<g opacity="${opacity}">
          <rect x="${x}" y="${y}" width="${obj.width}" height="${obj.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="8" />
          <text x="${x + 12}" y="${y + 24}" fill="#FAFAFA" font-size="14" font-family="sans-serif">${textEls}</text>
        </g>`
      }

      default:
        return `<rect x="${x}" y="${y}" width="${obj.width}" height="${obj.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`
    }
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="white" />
  ${elements.join('\n  ')}
</svg>`
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Canvas to JSON ──────────────────────────────────────────────────

export function canvasToJSON(
  objects: Array<Record<string, unknown>>,
  metadata?: Record<string, unknown>
): string {
  return JSON.stringify(
    {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      metadata: metadata ?? {},
      objects,
    },
    null,
    2
  )
}

// ─── HTML Wrapper (for document export) ──────────────────────────────

export function wrapHTMLForExport(html: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #333; }
    h1 { font-size: 2em; margin-top: 1.5em; }
    h2 { font-size: 1.5em; margin-top: 1.3em; }
    h3 { font-size: 1.2em; margin-top: 1.2em; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 4px; overflow-x: auto; }
    code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
    blockquote { border-left: 4px solid #ddd; margin-left: 0; padding-left: 16px; color: #666; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    img { max-width: 100%; }
    hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
  </style>
</head>
<body>
  ${html}
</body>
</html>`
}

// ─── Export Format Helpers ─────────────────────────────────────────────

export function getExportFormats(editorType: string): string[] {
  switch (editorType) {
    case 'document':
      return ['pdf', 'docx', 'markdown', 'html']
    case 'note':
      return ['markdown', 'html', 'pdf']
    case 'spreadsheet':
      return ['csv', 'xlsx']
    case 'presentation':
      return ['pptx', 'pdf']
    case 'canvas':
      return ['png', 'svg', 'json']
    default:
      return ['html']
  }
}

export function getExportMimeType(format: string): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'csv':
      return 'text/csv'
    case 'markdown':
      return 'text/markdown'
    case 'html':
      return 'text/html'
    case 'svg':
      return 'image/svg+xml'
    case 'png':
      return 'image/png'
    case 'json':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}
